import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  recoverInterruptedAtomicWrite,
  writeFileAtomically,
} from "../rag/atomic-file-write.js";
import { migrateConversation } from "./conversation-migrations.js";
import {
  CONVERSATION_SCHEMA_VERSION,
  toIndexEntry,
  type ConversationIndexEntry,
  type ConversationIndexFile,
  type ConversationRecord,
} from "./conversation-types.js";

export interface ConversationStoreInitializeResult {
  rebuiltIndex: boolean;
  quarantinedCount: number;
}

export interface ConversationStore {
  initialize(): Promise<ConversationStoreInitializeResult>;
  list(): Promise<ConversationIndexEntry[]>;
  load(id: string): Promise<ConversationRecord | undefined>;
  save(record: ConversationRecord): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  getActiveId(): Promise<string | undefined>;
  flush(): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sortEntries(entries: ConversationIndexEntry[]): ConversationIndexEntry[] {
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function createConversationStore(options: { rootDir: string }): ConversationStore {
  const sessionsDir = join(options.rootDir, "sessions");
  const corruptDir = join(options.rootDir, "corrupt");
  const indexPath = join(options.rootDir, "index.json");
  let index: ConversationIndexFile = {
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    conversations: [],
  };
  let initialized = false;
  let indexTail = Promise.resolve();
  const sessionTails = new Map<string, Promise<void>>();

  function sessionPath(id: string): string {
    if (!/^[A-Za-z0-9_.-]+$/u.test(id)) throw new Error("CONVERSATION_ID_INVALID");
    return join(sessionsDir, `${id}.json`);
  }

  function queueIndex(task: () => Promise<void>): Promise<void> {
    const result = indexTail.then(task, task);
    indexTail = result.catch(() => undefined);
    return result;
  }

  function queueSession(id: string, task: () => Promise<void>): Promise<void> {
    const tail = sessionTails.get(id) ?? Promise.resolve();
    const result = tail.then(task, task);
    const settled = result.catch(() => undefined);
    sessionTails.set(id, settled);
    void settled.finally(() => {
      if (sessionTails.get(id) === settled) sessionTails.delete(id);
    });
    return result;
  }

  async function persistIndex(): Promise<void> {
    await writeFileAtomically(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }

  async function quarantine(path: string): Promise<void> {
    await mkdir(corruptDir, { recursive: true });
    const target = join(corruptDir, `${Date.now()}-${basename(path)}`);
    await rename(path, target);
  }

  async function rebuildIndex(): Promise<number> {
    const conversations: ConversationIndexEntry[] = [];
    let quarantinedCount = 0;
    let names: string[] = [];
    try {
      names = await readdir(sessionsDir);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    for (const name of names.filter((value) => value.endsWith(".json"))) {
      const path = join(sessionsDir, name);
      try {
        const record = migrateConversation(JSON.parse(await readFile(path, "utf8")));
        conversations.push(toIndexEntry(record));
      } catch {
        await quarantine(path);
        quarantinedCount += 1;
      }
    }
    const active = index.activeConversationId;
    index = {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      activeConversationId: conversations.some(({ id }) => id === active)
        ? active
        : sortEntries([...conversations])[0]?.id,
      conversations: sortEntries(conversations),
    };
    await persistIndex();
    return quarantinedCount;
  }

  async function readIndex(): Promise<boolean> {
    try {
      const parsed = JSON.parse(await readFile(indexPath, "utf8")) as Partial<ConversationIndexFile>;
      if (parsed.schemaVersion !== CONVERSATION_SCHEMA_VERSION || !Array.isArray(parsed.conversations)) {
        return false;
      }
      index = {
        schemaVersion: CONVERSATION_SCHEMA_VERSION,
        activeConversationId: typeof parsed.activeConversationId === "string" ? parsed.activeConversationId : undefined,
        conversations: parsed.conversations as ConversationIndexEntry[],
      };
      return true;
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return false;
      throw error;
    }
  }

  return {
    async initialize() {
      await mkdir(sessionsDir, { recursive: true });
      await mkdir(corruptDir, { recursive: true });
      await recoverInterruptedAtomicWrite(indexPath);
      const loaded = await readIndex();
      const quarantinedCount = loaded ? 0 : await rebuildIndex();
      initialized = true;
      return { rebuiltIndex: !loaded, quarantinedCount };
    },

    async list() {
      if (!initialized) throw new Error("CONVERSATION_STORE_NOT_INITIALIZED");
      await indexTail;
      return clone(sortEntries([...index.conversations]));
    },

    async load(id) {
      if (!initialized) throw new Error("CONVERSATION_STORE_NOT_INITIALIZED");
      await (sessionTails.get(id) ?? Promise.resolve());
      const path = sessionPath(id);
      try {
        await recoverInterruptedAtomicWrite(path);
        return clone(migrateConversation(JSON.parse(await readFile(path, "utf8"))));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },

    save(record) {
      if (!initialized) return Promise.reject(new Error("CONVERSATION_STORE_NOT_INITIALIZED"));
      const snapshot = clone(migrateConversation(record));
      return queueSession(snapshot.id, async () => {
        await writeFileAtomically(sessionPath(snapshot.id), `${JSON.stringify(snapshot, null, 2)}\n`);
        await queueIndex(async () => {
          index.conversations = sortEntries([
            ...index.conversations.filter(({ id }) => id !== snapshot.id),
            toIndexEntry(snapshot),
          ]);
          if (!index.activeConversationId) index.activeConversationId = snapshot.id;
          await persistIndex();
        });
      });
    },

    remove(id) {
      if (!initialized) return Promise.reject(new Error("CONVERSATION_STORE_NOT_INITIALIZED"));
      return queueSession(id, async () => {
        await rm(sessionPath(id), { force: true });
        await queueIndex(async () => {
          index.conversations = index.conversations.filter((entry) => entry.id !== id);
          if (index.activeConversationId === id) {
            index.activeConversationId = sortEntries([...index.conversations])[0]?.id;
          }
          await persistIndex();
        });
      });
    },

    setActive(id) {
      if (!initialized) return Promise.reject(new Error("CONVERSATION_STORE_NOT_INITIALIZED"));
      return queueIndex(async () => {
        if (!index.conversations.some((entry) => entry.id === id)) {
          throw new Error("CONVERSATION_NOT_FOUND");
        }
        index.activeConversationId = id;
        await persistIndex();
      });
    },

    async getActiveId() {
      if (!initialized) throw new Error("CONVERSATION_STORE_NOT_INITIALIZED");
      await indexTail;
      return index.activeConversationId;
    },

    async flush() {
      await Promise.all([...sessionTails.values()]);
      await indexTail;
    },
  };
}
