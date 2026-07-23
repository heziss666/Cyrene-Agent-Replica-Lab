import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CurrencyWarGameIndexEntry, CurrencyWarGameState } from "../../../shared/currency-war-api-types.js";
import { recoverInterruptedAtomicWrite, writeFileAtomically } from "../../rag/atomic-file-write.js";
import { migrateGameState } from "../state/game-state-migrations.js";
import {
  CURRENCY_WAR_GAME_INDEX_SCHEMA_VERSION,
  toCurrencyWarGameIndexEntry,
  type CurrencyWarGameIndexFile,
} from "./currency-war-game-types.js";

export interface CurrencyWarGameStore {
  initialize(): Promise<{ rebuiltIndex: boolean; quarantinedCount: number }>;
  list(): Promise<CurrencyWarGameIndexEntry[]>;
  load(gameId: string): Promise<CurrencyWarGameState | undefined>;
  save(state: CurrencyWarGameState): Promise<void>;
  remove(gameId: string): Promise<void>;
  setActive(gameId: string): Promise<void>;
  getActiveId(): Promise<string | undefined>;
  flush(): Promise<void>;
}

export function createCurrencyWarGameStore(options: { rootDir: string }): CurrencyWarGameStore {
  const sessionsDir = join(options.rootDir, "sessions");
  const corruptDir = join(options.rootDir, "corrupt");
  const indexPath = join(options.rootDir, "index.json");
  let index: CurrencyWarGameIndexFile = { schemaVersion: 1, games: [] };
  let initialized = false;
  let indexTail = Promise.resolve();
  const sessionTails = new Map<string, Promise<void>>();

  const clone = <T>(value: T): T => structuredClone(value);
  const sort = (values: CurrencyWarGameIndexEntry[]) =>
    values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.gameId.localeCompare(b.gameId));
  const ensureInitialized = () => {
    if (!initialized) throw new Error("CURRENCY_WAR_GAME_STORE_NOT_INITIALIZED");
  };
  const sessionPath = (gameId: string) => {
    if (!/^[A-Za-z0-9_.-]+$/u.test(gameId)) throw new Error("CURRENCY_WAR_GAME_ID_INVALID");
    return join(sessionsDir, `${gameId}.json`);
  };
  const queueIndex = (task: () => Promise<void>) => {
    const result = indexTail.then(task, task);
    indexTail = result.catch(() => undefined);
    return result;
  };
  const queueSession = (gameId: string, task: () => Promise<void>) => {
    const result = (sessionTails.get(gameId) ?? Promise.resolve()).then(task, task);
    const settled = result.catch(() => undefined);
    sessionTails.set(gameId, settled);
    void settled.finally(() => {
      if (sessionTails.get(gameId) === settled) sessionTails.delete(gameId);
    });
    return result;
  };
  const persistIndex = () => writeFileAtomically(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const quarantine = async (path: string) => {
    await mkdir(corruptDir, { recursive: true });
    await rename(path, join(corruptDir, `${Date.now()}-${basename(path)}`));
  };
  const rebuildIndex = async () => {
    const games: CurrencyWarGameIndexEntry[] = [];
    let quarantinedCount = 0;
    let names: string[] = [];
    try {
      names = await readdir(sessionsDir);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    for (const name of names.filter((value) => value.endsWith(".json"))) {
      const path = join(sessionsDir, name);
      const gameId = basename(name, ".json");
      try {
        const state = migrateGameState(JSON.parse(await readFile(path, "utf8")), gameId);
        games.push(toCurrencyWarGameIndexEntry(state));
      } catch {
        await quarantine(path);
        quarantinedCount += 1;
      }
    }
    const sorted = sort(games);
    index = {
      schemaVersion: 1,
      activeGameId: sorted.some(({ gameId }) => gameId === index.activeGameId)
        ? index.activeGameId
        : sorted[0]?.gameId,
      games: sorted,
    };
    await persistIndex();
    return quarantinedCount;
  };

  return {
    async initialize() {
      await mkdir(sessionsDir, { recursive: true });
      await mkdir(corruptDir, { recursive: true });
      await recoverInterruptedAtomicWrite(indexPath);
      let loaded = false;
      try {
        const parsed = JSON.parse(await readFile(indexPath, "utf8")) as Partial<CurrencyWarGameIndexFile>;
        if (parsed.schemaVersion === CURRENCY_WAR_GAME_INDEX_SCHEMA_VERSION && Array.isArray(parsed.games)) {
          index = {
            schemaVersion: 1,
            activeGameId: typeof parsed.activeGameId === "string" ? parsed.activeGameId : undefined,
            games: parsed.games as CurrencyWarGameIndexEntry[],
          };
          loaded = true;
        }
      } catch (error) {
        if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
      }
      const quarantinedCount = loaded ? 0 : await rebuildIndex();
      initialized = true;
      return { rebuiltIndex: !loaded, quarantinedCount };
    },
    async list() {
      ensureInitialized();
      await indexTail;
      return clone(sort([...index.games]));
    },
    async load(gameId) {
      ensureInitialized();
      await (sessionTails.get(gameId) ?? Promise.resolve());
      const path = sessionPath(gameId);
      try {
        await recoverInterruptedAtomicWrite(path);
        return clone(migrateGameState(JSON.parse(await readFile(path, "utf8")), gameId));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    save(state) {
      ensureInitialized();
      const snapshot = clone(state);
      return queueSession(snapshot.gameId, async () => {
        await writeFileAtomically(sessionPath(snapshot.gameId), `${JSON.stringify(snapshot, null, 2)}\n`);
        await queueIndex(async () => {
          index.games = sort([
            ...index.games.filter(({ gameId }) => gameId !== snapshot.gameId),
            toCurrencyWarGameIndexEntry(snapshot),
          ]);
          index.activeGameId ??= snapshot.gameId;
          await persistIndex();
        });
      });
    },
    remove(gameId) {
      ensureInitialized();
      return queueSession(gameId, async () => {
        await rm(sessionPath(gameId), { force: true });
        await queueIndex(async () => {
          index.games = index.games.filter((entry) => entry.gameId !== gameId);
          if (index.activeGameId === gameId) index.activeGameId = sort([...index.games])[0]?.gameId;
          await persistIndex();
        });
      });
    },
    setActive(gameId) {
      ensureInitialized();
      return queueIndex(async () => {
        if (!index.games.some((entry) => entry.gameId === gameId)) throw new Error("CURRENCY_WAR_GAME_NOT_FOUND");
        index.activeGameId = gameId;
        await persistIndex();
      });
    },
    async getActiveId() {
      ensureInitialized();
      await indexTail;
      return index.activeGameId;
    },
    async flush() {
      await Promise.all([...sessionTails.values()]);
      await indexTail;
    },
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
