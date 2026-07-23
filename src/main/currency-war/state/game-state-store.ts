import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CurrencyWarGameState } from "../../../shared/currency-war-api-types.js";
import {
  recoverInterruptedAtomicWrite,
  writeFileAtomically,
} from "../../rag/atomic-file-write.js";
import { migrateGameState } from "./game-state-migrations.js";

export interface CurrencyWarGameStateStore {
  initialize(): Promise<void>;
  load(conversationId: string): Promise<CurrencyWarGameState | null>;
  save(state: CurrencyWarGameState): Promise<void>;
  remove(conversationId: string): Promise<void>;
  flush(): Promise<void>;
}

export function createCurrencyWarGameStateStore(options: {
  rootDir: string;
}): CurrencyWarGameStateStore {
  let initialized = false;
  const tails = new Map<string, Promise<void>>();

  function pathFor(conversationId: string): string {
    if (!/^[A-Za-z0-9_.-]+$/u.test(conversationId)) {
      throw new Error("CONVERSATION_ID_INVALID");
    }
    return join(options.rootDir, `${conversationId}.json`);
  }

  function queue(conversationId: string, task: () => Promise<void>): Promise<void> {
    const previous = tails.get(conversationId) ?? Promise.resolve();
    const result = previous.then(task, task);
    const settled = result.catch(() => undefined);
    tails.set(conversationId, settled);
    void settled.finally(() => {
      if (tails.get(conversationId) === settled) tails.delete(conversationId);
    });
    return result;
  }

  function requireInitialized(): void {
    if (!initialized) throw new Error("GAME_STATE_STORE_NOT_INITIALIZED");
  }

  return {
    async initialize() {
      await mkdir(options.rootDir, { recursive: true });
      initialized = true;
    },

    async load(conversationId) {
      requireInitialized();
      await (tails.get(conversationId) ?? Promise.resolve());
      const filePath = pathFor(conversationId);
      try {
        await recoverInterruptedAtomicWrite(filePath);
        return structuredClone(migrateGameState(
          JSON.parse(await readFile(filePath, "utf8")),
          conversationId,
        ));
      } catch (error) {
        if (isMissing(error)) return null;
        if (error instanceof SyntaxError) throw new Error("GAME_STATE_FILE_CORRUPT", { cause: error });
        throw error;
      }
    },

    save(state) {
      requireInitialized();
      const snapshot = structuredClone(state);
      return queue(snapshot.conversationId, async () => {
        await writeFileAtomically(
          pathFor(snapshot.conversationId),
          `${JSON.stringify(snapshot, null, 2)}\n`,
        );
      });
    },

    remove(conversationId) {
      requireInitialized();
      return queue(conversationId, async () => {
        await rm(pathFor(conversationId), { force: true });
      });
    },

    async flush() {
      requireInitialized();
      await Promise.all([...tails.values()]);
    },
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
