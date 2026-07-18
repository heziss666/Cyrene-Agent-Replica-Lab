import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { recoverInterruptedAtomicWrite, writeFileAtomically } from "../rag/atomic-file-write.js";
import { AGENT_RUN_SCHEMA_VERSION, type AgentRunRecord, type AgentRunSummary } from "./agent-run-types.js";
import { applyRunRetention } from "./run-retention.js";

export interface AgentRunStore {
  initialize(): Promise<{ rebuiltIndex: boolean; quarantinedCount: number }>;
  list(): Promise<AgentRunSummary[]>;
  load(id: string): Promise<AgentRunRecord | undefined>;
  save(record: AgentRunRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

interface IndexFile { schemaVersion: 1; records: AgentRunSummary[] }
const MAX_AGE_MS = 30 * 86_400_000;
function summary(record: AgentRunRecord): AgentRunSummary { const { events: _events, ...rest } = record; return structuredClone(rest); }
function valid(value: unknown): value is AgentRunRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AgentRunRecord>;
  return record.schemaVersion === AGENT_RUN_SCHEMA_VERSION && typeof record.runId === "string"
    && typeof record.queuedAt === "string" && Array.isArray(record.events) && typeof record.status === "string";
}
function missing(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT"; }

export function createAgentRunStore(options: { rootDir: string; now?: () => Date }): AgentRunStore {
  const recordsDir = join(options.rootDir, "records"); const corruptDir = join(options.rootDir, "corrupt");
  const indexPath = join(options.rootDir, "index.json"); const now = options.now ?? (() => new Date());
  let index: IndexFile = { schemaVersion: 1, records: [] }; let initialized = false; let tail = Promise.resolve();
  const pathFor = (id: string) => { if (!/^run_[A-Za-z0-9_.-]+$/.test(id)) throw new Error("AGENT_RUN_ID_INVALID"); return join(recordsDir, `${id}.json`); };
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => { const result = tail.then(fn, fn); tail = result.then(() => undefined, () => undefined); return result; };
  const persistIndex = () => writeFileAtomically(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  async function quarantine(path: string) { await mkdir(corruptDir, { recursive: true }); await rename(path, join(corruptDir, `${Date.now()}-${basename(path)}`)); }
  async function rebuild(): Promise<number> {
    const records: AgentRunSummary[] = []; let quarantined = 0; let names: string[] = [];
    try { names = await readdir(recordsDir); } catch (error) { if (!missing(error)) throw error; }
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      const path = join(recordsDir, name);
      try { const record: unknown = JSON.parse(await readFile(path, "utf8")); if (!valid(record)) throw new Error("invalid"); records.push(summary(record)); }
      catch { await quarantine(path); quarantined += 1; }
    }
    index = { schemaVersion: 1, records: records.sort((a, b) => b.queuedAt.localeCompare(a.queuedAt)) }; await persistIndex(); return quarantined;
  }
  async function enforceRetention() {
    const loaded = (await Promise.all(index.records.map(({ runId }) => readRecord(runId)))).filter((item): item is AgentRunRecord => !!item);
    const retained = applyRunRetention(loaded, { now: now(), maxAgeMs: MAX_AGE_MS, maxRecords: 1000 });
    for (const record of retained.removed) await rm(pathFor(record.runId), { force: true });
    index.records = retained.kept.map(summary); await persistIndex();
  }
  async function readRecord(id: string): Promise<AgentRunRecord | undefined> {
    try { const value: unknown = JSON.parse(await readFile(pathFor(id), "utf8")); if (!valid(value)) throw new Error("AGENT_RUN_SCHEMA_INVALID"); return structuredClone(value); }
    catch (error) { if (missing(error)) return undefined; throw error; }
  }
  return {
    async initialize() {
      await mkdir(recordsDir, { recursive: true }); await mkdir(corruptDir, { recursive: true }); await recoverInterruptedAtomicWrite(indexPath);
      let rebuilt = false; let quarantinedCount = 0;
      try { const value = JSON.parse(await readFile(indexPath, "utf8")) as IndexFile; if (value.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Error("invalid"); index = value; }
      catch (error) { if (!missing(error) && !(error instanceof SyntaxError) && (error as Error).message !== "invalid") throw error; rebuilt = true; quarantinedCount = await rebuild(); }
      initialized = true; await serialize(enforceRetention); return { rebuiltIndex: rebuilt, quarantinedCount };
    },
    async list() { if (!initialized) throw new Error("AGENT_RUN_STORE_NOT_INITIALIZED"); await tail; return structuredClone(index.records); },
    async load(id) { if (!initialized) throw new Error("AGENT_RUN_STORE_NOT_INITIALIZED"); await tail; return readRecord(id); },
    save(record) { if (!initialized) return Promise.reject(new Error("AGENT_RUN_STORE_NOT_INITIALIZED")); const snapshot = structuredClone(record); if (!valid(snapshot)) return Promise.reject(new Error("AGENT_RUN_SCHEMA_INVALID")); return serialize(async () => { await writeFileAtomically(pathFor(snapshot.runId), `${JSON.stringify(snapshot, null, 2)}\n`); index.records = [summary(snapshot), ...index.records.filter(({ runId }) => runId !== snapshot.runId)]; await enforceRetention(); }); },
    remove(id) { return serialize(async () => { await rm(pathFor(id), { force: true }); index.records = index.records.filter(({ runId }) => runId !== id); await persistIndex(); }); },
    clear() { return serialize(async () => { for (const item of index.records) await rm(pathFor(item.runId), { force: true }); index.records = []; await persistIndex(); }); },
    async flush() { await tail; },
  };
}
