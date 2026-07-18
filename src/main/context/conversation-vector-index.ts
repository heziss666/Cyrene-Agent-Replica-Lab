import { readFile } from "node:fs/promises";
import { recoverInterruptedAtomicWrite, writeFileAtomically } from "../rag/atomic-file-write.js";

const SCHEMA_VERSION = 1 as const;

export interface ConversationVectorEntry {
  conversationId: string;
  chunkId: string;
  textHash: string;
  vector: number[];
}

export interface ConversationVectorKey {
  chunkId: string;
  textHash: string;
}

export type ConversationVectorLoadStatus = "missing" | "loaded" | "incompatible" | "corrupt";

export interface ConversationVectorIndex {
  initialize(): Promise<{ status: ConversationVectorLoadStatus; loadedEntries: number }>;
  get(conversationId: string, chunkId: string, textHash: string): number[] | undefined;
  addMany(entries: ConversationVectorEntry[]): Promise<void>;
  pruneConversation(conversationId: string, valid: ConversationVectorKey[]): Promise<number>;
  removeConversation(conversationId: string): Promise<number>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

interface VectorFile {
  schemaVersion: typeof SCHEMA_VERSION;
  embedding: { providerId: string; model: string; dimensions: number };
  entries: ConversationVectorEntry[];
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function validEntry(value: unknown): value is ConversationVectorEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<ConversationVectorEntry>;
  return typeof entry.conversationId === "string" && typeof entry.chunkId === "string"
    && typeof entry.textHash === "string" && Array.isArray(entry.vector)
    && entry.vector.length > 0 && entry.vector.every((item) => typeof item === "number" && Number.isFinite(item));
}

export function createConversationVectorIndex(options: {
  filePath: string;
  providerId: string;
  model: string;
}): ConversationVectorIndex {
  let file: VectorFile = {
    schemaVersion: SCHEMA_VERSION,
    embedding: { providerId: options.providerId, model: options.model, dimensions: 0 },
    entries: [],
  };
  let initialized = false;
  let tail = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function persist(): Promise<void> {
    await writeFileAtomically(options.filePath, `${JSON.stringify(file, null, 2)}\n`);
  }

  function key(entry: Pick<ConversationVectorEntry, "conversationId" | "chunkId" | "textHash">): string {
    return `${entry.conversationId}\u0000${entry.chunkId}\u0000${entry.textHash}`;
  }

  return {
    async initialize() {
      if (initialized) return { status: "loaded" as const, loadedEntries: file.entries.length };
      await recoverInterruptedAtomicWrite(options.filePath);
      try {
        const value = JSON.parse(await readFile(options.filePath, "utf8")) as Partial<VectorFile>;
        if (
          value.schemaVersion !== SCHEMA_VERSION || !value.embedding || !Array.isArray(value.entries)
          || !value.entries.every(validEntry) || typeof value.embedding.dimensions !== "number"
        ) {
          initialized = true;
          return { status: "corrupt", loadedEntries: 0 };
        }
        if (value.embedding.providerId !== options.providerId || value.embedding.model !== options.model) {
          initialized = true;
          return { status: "incompatible", loadedEntries: 0 };
        }
        if (value.entries.some((entry) => entry.vector.length !== value.embedding!.dimensions)) {
          initialized = true;
          return { status: "corrupt", loadedEntries: 0 };
        }
        file = value as VectorFile;
        initialized = true;
        return { status: "loaded", loadedEntries: file.entries.length };
      } catch (error) {
        initialized = true;
        if (isMissing(error)) return { status: "missing", loadedEntries: 0 };
        return { status: "corrupt", loadedEntries: 0 };
      }
    },

    get(conversationId, chunkId, textHash) {
      if (!initialized) throw new Error("CONVERSATION_VECTOR_INDEX_NOT_INITIALIZED");
      const found = file.entries.find((entry) => entry.conversationId === conversationId && entry.chunkId === chunkId && entry.textHash === textHash);
      return found ? [...found.vector] : undefined;
    },

    addMany(entries) {
      if (!initialized) return Promise.reject(new Error("CONVERSATION_VECTOR_INDEX_NOT_INITIALIZED"));
      return serialize(async () => {
        if (entries.length === 0) return;
        if (!entries.every(validEntry)) throw new Error("CONVERSATION_VECTOR_ENTRY_INVALID");
        const dimensions = file.embedding.dimensions || entries[0].vector.length;
        if (entries.some(({ vector }) => vector.length !== dimensions)) {
          throw new Error("CONVERSATION_VECTOR_DIMENSIONS_INVALID");
        }
        file.embedding.dimensions = dimensions;
        const replacements = new Map(entries.map((entry) => [key(entry), { ...entry, vector: [...entry.vector] }]));
        file.entries = file.entries.filter((entry) => !replacements.has(key(entry)));
        file.entries.push(...replacements.values());
        await persist();
      });
    },

    pruneConversation(conversationId, valid) {
      return serialize(async () => {
        const allowed = new Set(valid.map(({ chunkId, textHash }) => `${chunkId}\u0000${textHash}`));
        const before = file.entries.length;
        file.entries = file.entries.filter((entry) =>
          entry.conversationId !== conversationId || allowed.has(`${entry.chunkId}\u0000${entry.textHash}`)
        );
        const removed = before - file.entries.length;
        if (removed > 0) await persist();
        return removed;
      });
    },

    removeConversation(conversationId) {
      return serialize(async () => {
        const before = file.entries.length;
        file.entries = file.entries.filter((entry) => entry.conversationId !== conversationId);
        const removed = before - file.entries.length;
        if (removed > 0) await persist();
        return removed;
      });
    },

    clear() {
      return serialize(async () => {
        file.entries = [];
        file.embedding.dimensions = 0;
        await persist();
      });
    },

    async flush() {
      await tail;
    },
  };
}
