# Phase 6C Persistent Vector Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist document embeddings in a validated JSON index so later application processes reuse unchanged chunk vectors and only embed new or modified chunks.

**Architecture:** `VectorRetriever` depends on an asynchronous `VectorIndex` contract, while `InMemoryVectorIndex` and `JsonVectorIndex` provide interchangeable implementations. The JSON implementation validates provider, model, chunking, dimensions, hashes, and vectors before reuse; file writes use a recoverable same-directory replacement helper. `KnowledgeBase` remains the orchestration layer and falls back to keyword search when vector initialization or persistence fails.

**Tech Stack:** TypeScript 5.7, Node.js 22 ESM, `node:fs/promises`, `node:crypto`, Electron, Vitest 2, Ollama `/api/embed`, SHA-256, JSON.

## Global Constraints

- Keep Node.js 22 and the existing npm dependencies; add no database or storage package.
- Use asynchronous `node:fs/promises` APIs in application code; do not add synchronous file I/O to Electron main-process paths.
- Default data directory: `~/.cyrene-agent-replica-lab/rag`.
- Environment override: `CYRENE_RAG_DATA_DIR`.
- Persistent file name: `vector-index.json`.
- Index schema version: numeric literal `1`.
- Chunking identity: `chunkSizeChars = 600`, `overlapChars = 120`.
- Entry identity requires both `chunkId` and SHA-256 `textHash`.
- Automated tests use fake embedding providers and temporary directories; they must not contact Ollama or write into the real user profile.
- Keep `search_knowledge` query-writing guidance in its Tool Schema, not in the global System Prompt.
- Do not modify the Agent Loop, vendor adapters, IPC channels, preload bridge, or renderer in this phase.
- Do not implement document import, a knowledge-management UI, SQLite, a vector database, BM25, hybrid retrieval, reranking, ANN search, or memory.

## File Map

**Create:**

- `src/main/config/rag-storage-config.ts`: resolves the persistent RAG data directory and index path.
- `src/main/rag/vector-index-types.ts`: owns all storage-independent index types and the `VectorIndex` interface.
- `src/main/rag/text-hash.ts`: computes stable SHA-256 hashes for chunk text.
- `src/main/rag/atomic-file-write.ts`: performs same-directory temporary writes and recoverable replacement.
- `src/main/rag/json-vector-index.ts`: validates, loads, mutates, prunes, clears, and saves the JSON index.
- `tests/config/rag-storage-config.test.ts`: tests default and overridden paths.
- `tests/rag/text-hash.test.ts`: tests stable content hashing.
- `tests/rag/atomic-file-write.test.ts`: tests direct replacement and Windows-style recovery.
- `tests/rag/json-vector-index.test.ts`: tests load states, validation, persistence, pruning, and clearing.
- `tests/rag/vector-index-persistence.test.ts`: proves reuse across two independent retriever/index instances.
- `docs/learning/phase-06c-persistent-vector-index.zh-CN.md`: beginner-oriented Chinese explanation written from the completed implementation.

**Modify:**

- `src/cli/chat.ts` and `tests/cli/chat.test.ts`: remove tool-specific guidance from the System Prompt.
- `src/main/rag/default-knowledge.ts`: update stale seed text and assemble the persistent index.
- `src/main/rag/chunk-text.ts`: export the existing chunking defaults as shared identity constants.
- `src/main/rag/in-memory-vector-index.ts` and its tests: implement the asynchronous shared contract.
- `src/main/rag/vector-retriever.ts` and its tests: initialize, hash, prune, batch-add, and asynchronously clear.
- `src/main/rag/knowledge-base.ts` and its tests: make knowledge clearing asynchronous.
- `src/main/tools/built-in-tools.ts` and its tests: support safe index injection in tests without changing Tool behavior.

---

### Task 1: Correct Phase 6B Prompt and Seed Drift

**Files:**

- Modify: `src/cli/chat.ts`
- Modify: `src/main/rag/default-knowledge.ts`
- Modify: `tests/cli/chat.test.ts`
- Modify: `tests/tools/built-in-tools.test.ts`

**Interfaces:**

- Consumes: the existing `SYSTEM_PROMPT` and `search_knowledge` Tool Schema.
- Produces: a global prompt with only agent-wide rules and accurate seed knowledge for Phases 6B and 6C.

- [ ] **Step 1: Write the failing prompt and seed assertions**

Replace the two `createInitialHistory` tests in `tests/cli/chat.test.ts` with:

```ts
describe("createInitialHistory", () => {
  it("starts the CLI conversation with one system message", () => {
    expect(createInitialHistory()).toEqual([
      {
        role: "system",
        content: [
          "You are Cyrene Replica Lab, a minimal learning agent.",
          "Answer clearly and briefly.",
          "When explaining technical ideas, use beginner-friendly wording.",
        ].join("\n"),
      },
    ]);
  });

  it("keeps tool-specific query rules out of the system prompt", () => {
    expect(SYSTEM_PROMPT).not.toContain("search_knowledge");
    expect(SYSTEM_PROMPT).not.toContain("disconnected keyword list");
  });
});
```

Extend the existing Tool Schema test in `tests/tools/built-in-tools.test.ts` with these assertions, which protect the correct location of the rule:

```ts
expect(searchSpec?.description).toContain("standalone natural-language question");
expect(queryDescription).toContain("semantic vector search");
expect(queryDescription).toContain("Do not output a disconnected keyword list");
```

- [ ] **Step 2: Run the focused tests and verify the prompt test fails**

Run:

```cmd
npx vitest run tests/cli/chat.test.ts tests/tools/built-in-tools.test.ts
```

Expected: the CLI assertions fail because `SYSTEM_PROMPT` still contains the tool-specific sentence; Tool Schema assertions pass.

- [ ] **Step 3: Remove the tool rule from the global prompt and correct the seed text**

Change `SYSTEM_PROMPT` in `src/cli/chat.ts` to:

```ts
export const SYSTEM_PROMPT = [
  "You are Cyrene Replica Lab, a minimal learning agent.",
  "Answer clearly and briefly.",
  "When explaining technical ideas, use beginner-friendly wording.",
].join("\n");
```

Change only the `seed_minimal_rag.text` value in `src/main/rag/default-knowledge.ts` to:

```ts
text:
  "Minimal RAG stores local knowledge as text chunks. The search_knowledge tool retrieves relevant chunks and returns them to the model. " +
  "Phase 6B uses Ollama embeddings and vector search. Phase 6C persists document vectors for reuse across application restarts.",
```

- [ ] **Step 4: Verify and commit**

Run:

```cmd
npx vitest run tests/cli/chat.test.ts tests/tools/built-in-tools.test.ts
git add src/cli/chat.ts src/main/rag/default-knowledge.ts tests/cli/chat.test.ts tests/tools/built-in-tools.test.ts
git commit -m "fix: keep retrieval guidance in tool schema"
```

Expected: both test files pass; the Tool Schema still contains semantic-query guidance.

---

### Task 2: Add RAG Storage Configuration

**Files:**

- Create: `src/main/config/rag-storage-config.ts`
- Create: `tests/config/rag-storage-config.test.ts`

**Interfaces:**

- Consumes: `NodeJS.ProcessEnv`, an injectable home directory, and Node path utilities.
- Produces: `loadRagStorageConfig(env?, homeDir?) -> RagStorageConfig`.

- [ ] **Step 1: Write the failing configuration tests**

Create `tests/config/rag-storage-config.test.ts`:

```ts
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRagStorageConfig } from "../../src/main/config/rag-storage-config.js";

describe("loadRagStorageConfig", () => {
  it("uses a hidden RAG directory below the supplied home directory", () => {
    const config = loadRagStorageConfig({}, join("C:", "Users", "student"));

    expect(config.dataDir).toBe(
      join("C:", "Users", "student", ".cyrene-agent-replica-lab", "rag"),
    );
    expect(config.vectorIndexPath).toBe(join(config.dataDir, "vector-index.json"));
  });

  it("uses an absolute environment override after trimming whitespace", () => {
    const config = loadRagStorageConfig(
      { CYRENE_RAG_DATA_DIR: "  C:\\rag-test-data  " },
      "C:\\ignored-home",
    );

    expect(config.dataDir).toBe(resolve("C:\\rag-test-data"));
    expect(config.vectorIndexPath).toBe(
      join(resolve("C:\\rag-test-data"), "vector-index.json"),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```cmd
npx vitest run tests/config/rag-storage-config.test.ts
```

Expected: FAIL because `rag-storage-config.ts` does not exist.

- [ ] **Step 3: Implement the configuration loader**

Create `src/main/config/rag-storage-config.ts`:

```ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface RagStorageConfig {
  dataDir: string;
  vectorIndexPath: string;
}

export function loadRagStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): RagStorageConfig {
  const override = env.CYRENE_RAG_DATA_DIR?.trim();
  const dataDir = override
    ? resolve(override)
    : join(homeDir, ".cyrene-agent-replica-lab", "rag");

  return {
    dataDir,
    vectorIndexPath: join(dataDir, "vector-index.json"),
  };
}
```

- [ ] **Step 4: Verify and commit**

Run:

```cmd
npx vitest run tests/config/rag-storage-config.test.ts
npm run typecheck
git add src/main/config/rag-storage-config.ts tests/config/rag-storage-config.test.ts
git commit -m "feat: add RAG storage configuration"
```

Expected: configuration tests and type checking pass.

---

### Task 3: Define Index Types and Chunk Text Hashing

**Files:**

- Create: `src/main/rag/vector-index-types.ts`
- Create: `src/main/rag/text-hash.ts`
- Create: `tests/rag/text-hash.test.ts`
- Modify: `src/main/rag/chunk-text.ts`

**Interfaces:**

- Consumes: chunk text and the existing chunking defaults.
- Produces: `hashText(text)`, exported chunking constants, and the complete shared `VectorIndex` contract.

- [ ] **Step 1: Write the failing text-hash test**

Create `tests/rag/text-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashText } from "../../src/main/rag/text-hash.js";

describe("hashText", () => {
  it("returns the stable UTF-8 SHA-256 digest", () => {
    expect(hashText("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("changes when the chunk text changes", () => {
    expect(hashText("ToolRegistry registers tools.")).not.toBe(
      hashText("ToolRegistry validates and registers tools."),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run `npx vitest run tests/rag/text-hash.test.ts`.

Expected: FAIL because `text-hash.ts` does not exist.

- [ ] **Step 3: Implement the hash and shared index types**

Create `src/main/rag/text-hash.ts`:

```ts
import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
```

Create `src/main/rag/vector-index-types.ts`:

```ts
export const VECTOR_INDEX_SCHEMA_VERSION = 1 as const;

export interface VectorIndexEntryKey {
  chunkId: string;
  textHash: string;
}

export interface VectorIndexEntry extends VectorIndexEntryKey {
  vector: number[];
}

export interface VectorIndexIdentity {
  providerId: string;
  model: string;
  schemaVersion: typeof VECTOR_INDEX_SCHEMA_VERSION;
}

export interface VectorIndexFile {
  schemaVersion: typeof VECTOR_INDEX_SCHEMA_VERSION;
  embedding: {
    providerId: string;
    model: string;
    dimensions: number;
  };
  chunking: {
    chunkSizeChars: number;
    overlapChars: number;
  };
  entries: VectorIndexEntry[];
}

export type VectorIndexLoadStatus =
  | "missing"
  | "loaded"
  | "incompatible"
  | "corrupt";

export interface VectorIndexLoadResult {
  status: VectorIndexLoadStatus;
  loadedEntries: number;
  warning?: string;
}

export interface VectorIndex {
  initialize(): Promise<VectorIndexLoadResult>;
  has(chunkId: string, textHash: string): boolean;
  get(chunkId: string, textHash: string): number[] | undefined;
  addMany(entries: VectorIndexEntry[]): Promise<void>;
  prune(validEntries: VectorIndexEntryKey[]): Promise<number>;
  clear(): Promise<void>;
}
```

Export the existing constants in `src/main/rag/chunk-text.ts` without changing their values:

```ts
export const DEFAULT_CHUNK_SIZE_CHARS = 600;
export const DEFAULT_OVERLAP_CHARS = 120;
```

- [ ] **Step 4: Verify and commit**

Run:

```cmd
npx vitest run tests/rag/text-hash.test.ts tests/rag/chunk-text.test.ts
npm run typecheck
git add src/main/rag/vector-index-types.ts src/main/rag/text-hash.ts src/main/rag/chunk-text.ts tests/rag/text-hash.test.ts
git commit -m "feat: define vector index contracts"
```

Expected: both test files and type checking pass.

---

### Task 4: Upgrade the In-Memory Index and Its Retriever Consumer

**Files:**

- Modify: `src/main/rag/in-memory-vector-index.ts`
- Modify: `tests/rag/in-memory-vector-index.test.ts`
- Modify: `src/main/rag/vector-retriever.ts`
- Modify: `tests/rag/vector-retriever.test.ts`
- Modify: `tests/rag/knowledge-base.test.ts`

**Interfaces:**

- Consumes: `VectorIndex`, `VectorIndexEntry`, `VectorIndexEntryKey`, and `validateVector`.
- Produces: a fully asynchronous in-memory reference implementation plus a compiling hash-aware retriever consumer.

- [ ] **Step 1: Replace the tests with the new contract**

Replace `tests/rag/in-memory-vector-index.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";

describe("createInMemoryVectorIndex", () => {
  it("initializes once and stores defensive copies", async () => {
    const index = createInMemoryVectorIndex();
    const firstInitialization = index.initialize();
    const secondInitialization = index.initialize();
    expect(secondInitialization).toBe(firstInitialization);
    await expect(firstInitialization).resolves.toEqual({
      status: "missing",
      loadedEntries: 0,
    });

    const vector = [1, 2, 3];
    await index.addMany([{ chunkId: "one", textHash: "hash-one", vector }]);
    vector[0] = 99;
    const firstRead = index.get("one", "hash-one");
    firstRead![1] = 88;
    expect(index.get("one", "hash-one")).toEqual([1, 2, 3]);
  });

  it("requires both chunk id and text hash", async () => {
    const index = createInMemoryVectorIndex();
    await index.addMany([
      { chunkId: "one", textHash: "current", vector: [1, 0] },
    ]);

    expect(index.has("one", "current")).toBe(true);
    expect(index.has("one", "old")).toBe(false);
    expect(index.get("one", "old")).toBeUndefined();
  });

  it("rejects inconsistent dimensions for a batch", async () => {
    const index = createInMemoryVectorIndex();
    await expect(
      index.addMany([
        { chunkId: "one", textHash: "one", vector: [1, 2] },
        { chunkId: "two", textHash: "two", vector: [1, 2, 3] },
      ]),
    ).rejects.toThrow("Vector dimension mismatch: expected 2, received 3");
  });

  it("prunes removed and modified entries", async () => {
    const index = createInMemoryVectorIndex();
    await index.addMany([
      { chunkId: "keep", textHash: "same", vector: [1, 0] },
      { chunkId: "modified", textHash: "old", vector: [0, 1] },
      { chunkId: "removed", textHash: "gone", vector: [1, 1] },
    ]);

    await expect(
      index.prune([
        { chunkId: "keep", textHash: "same" },
        { chunkId: "modified", textHash: "new" },
      ]),
    ).resolves.toBe(2);
    expect(index.has("keep", "same")).toBe(true);
    expect(index.has("modified", "old")).toBe(false);
    expect(index.has("removed", "gone")).toBe(false);
  });

  it("clears entries and resets dimensions", async () => {
    const index = createInMemoryVectorIndex();
    await index.addMany([{ chunkId: "one", textHash: "one", vector: [1, 2] }]);
    await index.clear();
    await index.addMany([
      { chunkId: "two", textHash: "two", vector: [1, 2, 3] },
    ]);
    expect(index.has("one", "one")).toBe(false);
    expect(index.get("two", "two")).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run the test and verify interface failures**

Run `npx vitest run tests/rag/in-memory-vector-index.test.ts`.

Expected: FAIL because the implementation still exposes `add()` and synchronous `clear()`.

- [ ] **Step 3: Implement the new in-memory index**

Replace `src/main/rag/in-memory-vector-index.ts` with:

```ts
import { validateVector } from "./vector-math.js";
import type {
  VectorIndex,
  VectorIndexEntry,
  VectorIndexEntryKey,
} from "./vector-index-types.js";

function cloneEntry(entry: VectorIndexEntry): VectorIndexEntry {
  return { ...entry, vector: [...entry.vector] };
}

export function createInMemoryVectorIndex(): VectorIndex {
  const entries = new Map<string, VectorIndexEntry>();
  let dimensions: number | undefined;
  const initialization = Promise.resolve({
    status: "missing" as const,
    loadedEntries: 0,
  });

  function validateEntry(entry: VectorIndexEntry): void {
    validateVector(entry.vector, `Vector for ${entry.chunkId}`);
    if (dimensions !== undefined && entry.vector.length !== dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${dimensions}, received ${entry.vector.length}`,
      );
    }
    dimensions ??= entry.vector.length;
  }

  return {
    initialize() {
      return initialization;
    },

    has(chunkId, textHash) {
      return entries.get(chunkId)?.textHash === textHash;
    },

    get(chunkId, textHash) {
      const entry = entries.get(chunkId);
      return entry?.textHash === textHash ? [...entry.vector] : undefined;
    },

    async addMany(nextEntries) {
      const originalDimensions = dimensions;
      try {
        for (const entry of nextEntries) validateEntry(entry);
      } catch (error) {
        dimensions = originalDimensions;
        throw error;
      }
      for (const entry of nextEntries) entries.set(entry.chunkId, cloneEntry(entry));
    },

    async prune(validEntries: VectorIndexEntryKey[]) {
      const valid = new Map(validEntries.map((entry) => [entry.chunkId, entry.textHash]));
      let removed = 0;
      for (const [chunkId, entry] of entries) {
        if (valid.get(chunkId) !== entry.textHash) {
          entries.delete(chunkId);
          removed += 1;
        }
      }
      if (entries.size === 0) dimensions = undefined;
      return removed;
    },

    async clear() {
      entries.clear();
      dimensions = undefined;
    },
  };
}
```

- [ ] **Step 4: Update retriever tests for hashes and asynchronous clearing**

Keep the existing ranking, incremental-new-chunk, and empty-input tests in `tests/rag/vector-retriever.test.ts`. Add:

```ts
it("re-embeds a chunk whose text changed under the same id", async () => {
  const embedDocuments = vi
    .fn()
    .mockResolvedValueOnce([[1, 0]])
    .mockResolvedValueOnce([[0, 1]]);
  const provider: EmbeddingProvider = {
    id: "fake",
    model: "fake-model",
    embedDocuments,
    embedQuery: vi.fn(async () => [1, 0]),
  };
  const retriever = createVectorRetriever(provider, createInMemoryVectorIndex());

  await retriever.retrieve("query", [chunk("same-id", "old text")], 1);
  await retriever.retrieve("query", [chunk("same-id", "new text")], 1);

  expect(embedDocuments.mock.calls).toEqual([[['old text']], [['new text']]]);
});
```

In `tests/rag/knowledge-base.test.ts`, change the hand-written retriever clear function to:

```ts
const clear = vi.fn(async () => undefined);
```

- [ ] **Step 5: Replace VectorRetriever with the shared asynchronous contract**

Replace `src/main/rag/vector-retriever.ts` with:

```ts
import type { EmbeddingProvider } from "./embedding-provider.js";
import { hashText } from "./text-hash.js";
import type { VectorIndex } from "./vector-index-types.js";
import type { KnowledgeChunk, KnowledgeSearchResult } from "./rag-types.js";
import { cosineSimilarity } from "./vector-math.js";

export interface VectorRetriever {
  readonly model: string;
  retrieve(
    query: string,
    chunks: KnowledgeChunk[],
    topK?: number,
  ): Promise<KnowledgeSearchResult[]>;
  clear(): Promise<void>;
}

export function createVectorRetriever(
  provider: EmbeddingProvider,
  index: VectorIndex,
): VectorRetriever {
  return {
    model: provider.model,

    async retrieve(query, chunks, topK = 5) {
      const normalizedQuery = query.trim();
      if (!normalizedQuery || chunks.length === 0 || topK <= 0) return [];

      await index.initialize();
      const indexedChunks = chunks.map((chunk) => ({
        chunk,
        textHash: hashText(chunk.text),
      }));
      await index.prune(
        indexedChunks.map(({ chunk, textHash }) => ({
          chunkId: chunk.id,
          textHash,
        })),
      );

      const missing = indexedChunks.filter(
        ({ chunk, textHash }) => !index.has(chunk.id, textHash),
      );
      if (missing.length > 0) {
        const vectors = await provider.embedDocuments(
          missing.map(({ chunk }) => chunk.text),
        );
        if (vectors.length !== missing.length) {
          throw new Error(
            `Embedding provider returned ${vectors.length} vectors for ${missing.length} chunks`,
          );
        }
        await index.addMany(
          missing.map(({ chunk, textHash }, vectorIndex) => ({
            chunkId: chunk.id,
            textHash,
            vector: vectors[vectorIndex],
          })),
        );
      }

      const queryVector = await provider.embedQuery(normalizedQuery);
      return indexedChunks
        .map(({ chunk, textHash }) => {
          const vector = index.get(chunk.id, textHash);
          if (!vector) throw new Error(`Missing vector for chunk: ${chunk.id}`);
          return { chunk, score: cosineSimilarity(queryVector, vector) };
        })
        .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
        .slice(0, topK);
    },

    clear() {
      return index.clear();
    },
  };
}
```

- [ ] **Step 6: Run all contract consumers and verify they pass**

Run:

```cmd
npx vitest run tests/rag/in-memory-vector-index.test.ts tests/rag/vector-retriever.test.ts tests/rag/knowledge-base.test.ts
npm run typecheck
```

Expected: all focused tests and type checking pass. `KnowledgeBase.clear()` still ignores the returned Promise until Task 9, but its hand-written test double now satisfies the `VectorRetriever` type.

- [ ] **Step 7: Commit**

Run:

```cmd
git add src/main/rag/in-memory-vector-index.ts src/main/rag/vector-retriever.ts tests/rag/in-memory-vector-index.test.ts tests/rag/vector-retriever.test.ts tests/rag/knowledge-base.test.ts
git commit -m "refactor: make vector indexing hash-aware"
```

---

### Task 5: Add Recoverable Atomic File Replacement

**Files:**

- Create: `src/main/rag/atomic-file-write.ts`
- Create: `tests/rag/atomic-file-write.test.ts`

**Interfaces:**

- Consumes: a target path, UTF-8 content, and optional injected file operations.
- Produces: `writeFileAtomically(filePath, content, fileOps?) -> Promise<void>`.

- [ ] **Step 1: Write direct and fallback replacement tests**

Create `tests/rag/atomic-file-write.test.ts` with a fake operation recorder covering these exact behaviors:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  writeFileAtomically,
  type AtomicFileOperations,
} from "../../src/main/rag/atomic-file-write.js";

function operations(): AtomicFileOperations {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  };
}

describe("writeFileAtomically", () => {
  it("writes a same-directory temporary file then renames it", async () => {
    const ops = operations();
    await writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops);
    expect(ops.writeFile).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json.tmp",
      "{}",
      "utf8",
    );
    expect(ops.rename).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json.tmp",
      "C:\\rag\\vector-index.json",
    );
  });

  it("uses a backup when direct replacement is denied", async () => {
    const ops = operations();
    vi.mocked(ops.rename)
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))
      .mockResolvedValue(undefined);
    await writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops);
    expect(ops.rename).toHaveBeenNthCalledWith(
      2,
      "C:\\rag\\vector-index.json",
      "C:\\rag\\vector-index.json.bak",
    );
    expect(ops.rename).toHaveBeenNthCalledWith(
      3,
      "C:\\rag\\vector-index.json.tmp",
      "C:\\rag\\vector-index.json",
    );
    expect(ops.rm).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json.bak",
      { force: true },
    );
  });

  it("restores the backup when the fallback replacement fails", async () => {
    const ops = operations();
    vi.mocked(ops.rename)
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("replacement failed"))
      .mockResolvedValueOnce(undefined);
    await expect(
      writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops),
    ).rejects.toThrow("replacement failed");
    expect(ops.rename).toHaveBeenNthCalledWith(
      4,
      "C:\\rag\\vector-index.json.bak",
      "C:\\rag\\vector-index.json",
    );
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run `npx vitest run tests/rag/atomic-file-write.test.ts`.

Expected: FAIL because `atomic-file-write.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/main/rag/atomic-file-write.ts` using `mkdir`, `rename`, `rm`, and `writeFile` from `node:fs/promises`. Export this injectable boundary:

```ts
export interface AtomicFileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}
```

Create the production default with thin wrappers around the four imported Node functions, then implement this sequence:

```ts
const temporaryPath = `${filePath}.tmp`;
const backupPath = `${filePath}.bak`;
await fileOps.mkdir(dirname(filePath), { recursive: true });
await fileOps.writeFile(temporaryPath, content, "utf8");

try {
  await fileOps.rename(temporaryPath, filePath);
  return;
} catch (error) {
  if (!isReplacementError(error)) {
    await fileOps.rm(temporaryPath, { force: true });
    throw error;
  }
}

try {
  await fileOps.rename(filePath, backupPath);
  try {
    await fileOps.rename(temporaryPath, filePath);
  } catch (error) {
    await fileOps.rename(backupPath, filePath);
    throw error;
  }
  await fileOps.rm(backupPath, { force: true });
} finally {
  await fileOps.rm(temporaryPath, { force: true });
}
```

`isReplacementError()` must return true only for `EPERM`, `EACCES`, or `EEXIST`. Do not delete the formal file before a backup rename succeeds.

- [ ] **Step 4: Verify and commit**

Run:

```cmd
npx vitest run tests/rag/atomic-file-write.test.ts
git add src/main/rag/atomic-file-write.ts tests/rag/atomic-file-write.test.ts
git commit -m "feat: add recoverable atomic file writes"
```

Expected: all three replacement-path tests pass.

---

### Task 6: Implement JSON Index Loading and Persistence

**Files:**

- Create: `src/main/rag/json-vector-index.ts`
- Create: `tests/rag/json-vector-index.test.ts`

**Interfaces:**

- Consumes: `CreateJsonVectorIndexOptions`, shared index types, vector validation, and atomic file writing.
- Produces: `createJsonVectorIndex(options) -> VectorIndex` with `missing` and `loaded` states plus durable `addMany`, `prune`, and `clear`.

- [ ] **Step 1: Write basic JSON lifecycle tests**

Create `tests/rag/json-vector-index.test.ts`. Use `mkdtemp`, `readFile`, `rm`, and `tmpdir`; clean every temporary directory in `afterEach`. Define:

```ts
const identity = {
  providerId: "fake",
  model: "fake-model",
  schemaVersion: 1 as const,
};

function createIndex(filePath: string, logger = vi.fn()) {
  return createJsonVectorIndex({
    filePath,
    identity,
    chunkSizeChars: 600,
    overlapChars: 120,
    logger,
  });
}
```

Add tests proving:

```ts
expect(await first.initialize()).toEqual({ status: "missing", loadedEntries: 0 });
await first.addMany([
  { chunkId: "one", textHash: "hash-one", vector: [1, 0] },
  { chunkId: "two", textHash: "hash-two", vector: [0, 1] },
]);

const saved = JSON.parse(await readFile(filePath, "utf8"));
expect(saved.embedding).toEqual({ providerId: "fake", model: "fake-model", dimensions: 2 });
expect(saved.chunking).toEqual({ chunkSizeChars: 600, overlapChars: 120 });
expect(saved.entries).toHaveLength(2);

const second = createIndex(filePath);
expect(await second.initialize()).toEqual({ status: "loaded", loadedEntries: 2 });
expect(second.get("one", "hash-one")).toEqual([1, 0]);
```

Also assert that one `addMany()` call causes one logger message containing `vector index saved: 2 entries`, `prune([{ chunkId: "one", textHash: "hash-one" }])` returns `1` and persists one entry, and `clear()` removes the formal index file.

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run `npx vitest run tests/rag/json-vector-index.test.ts`.

Expected: FAIL because `json-vector-index.ts` does not exist.

- [ ] **Step 3: Implement state, initialization, mutation, and serialization**

Create `src/main/rag/json-vector-index.ts` with:

```ts
export interface CreateJsonVectorIndexOptions {
  filePath: string;
  identity: VectorIndexIdentity;
  chunkSizeChars: number;
  overlapChars: number;
  logger?: (message: string) => void;
}

export function createJsonVectorIndex(
  options: CreateJsonVectorIndexOptions,
): VectorIndex;
```

The implementation must hold `Map<string, VectorIndexEntry>`, `dimensions`, and one cached `initializationPromise`. Define `const logger = options.logger ?? console.log`. `initialize()` must call `readFile(options.filePath, "utf8")` once, return `missing` for `ENOENT`, log `[RAG] vector index missing`, parse and validate a compatible file, clone entries into the Map, and log `[RAG] vector index loaded: N entries`.

Use these exact internal serialization fields:

```ts
const file: VectorIndexFile = {
  schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
  embedding: {
    providerId: options.identity.providerId,
    model: options.identity.model,
    dimensions,
  },
  chunking: {
    chunkSizeChars: options.chunkSizeChars,
    overlapChars: options.overlapChars,
  },
  entries: [...entries.values()].map(cloneEntry),
};
await writeFileAtomically(options.filePath, `${JSON.stringify(file, null, 2)}\n`);
```

Every public mutating method must await `initialize()`. Validate the entire incoming batch before changing the Map. `prune()` saves only when at least one entry is removed. `clear()` clears state, resets dimensions, and calls `rm(options.filePath, { force: true })` plus safe cleanup of `.tmp` and `.bak`.

- [ ] **Step 4: Add strict runtime shape validation**

Inside the same file, add focused assertion helpers for plain objects, strings, positive integer dimensions, finite non-empty vectors, and arrays. Reject duplicate `chunkId` values. Use `validateVector()` for every vector and require every vector length to equal `embedding.dimensions`. Throw descriptive validation errors using the prefix `Invalid vector index:`, including the exact array error `Invalid vector index: entries must be an array`. Task 7 will catch these validation errors at the file-loading boundary and classify them as corrupt.

- [ ] **Step 5: Verify the basic lifecycle and commit**

Run:

```cmd
npx vitest run tests/rag/json-vector-index.test.ts
git add src/main/rag/json-vector-index.ts tests/rag/json-vector-index.test.ts
git commit -m "feat: persist vectors in a JSON index"
```

Expected: missing, save, reload, prune, clear, and save-count assertions pass.

---

### Task 7: Add Compatibility and Corruption Recovery

**Files:**

- Modify: `src/main/rag/json-vector-index.ts`
- Modify: `tests/rag/json-vector-index.test.ts`

**Interfaces:**

- Consumes: parsed index metadata and invalid persisted content.
- Produces: `incompatible` and `corrupt` load results, timestamped corrupt backups, and empty rebuildable state.

- [ ] **Step 1: Add failing compatibility tests**

Extend `tests/rag/json-vector-index.test.ts` to save a valid file, then initialize with each changed option:

```ts
{ identity: { ...identity, model: "new-model" } }
{ identity: { ...identity, providerId: "other-provider" } }
{ identity: { ...identity, schemaVersion: 1 as const }, chunkSizeChars: 700 }
{ identity: { ...identity, schemaVersion: 1 as const }, overlapChars: 80 }
```

For each case assert:

```ts
expect(result.status).toBe("incompatible");
expect(result.loadedEntries).toBe(0);
expect(result.warning).toContain(expectedReason);
```

Write a raw file with `schemaVersion: 2` and otherwise valid fields; expect `incompatible`, not `corrupt`.

- [ ] **Step 2: Add failing corruption tests**

Add cases for malformed JSON, missing `entries`, an empty vector, mismatched dimensions, non-finite values represented through a directly supplied parsed fixture path, and duplicate chunk IDs. For malformed JSON assert:

```ts
const result = await index.initialize();
expect(result.status).toBe("corrupt");
expect(result.loadedEntries).toBe(0);
expect(result.warning).toContain("backup created at");
expect((await readdir(tempDir)).some((name) =>
  /^vector-index\.corrupt-\d+\.json$/.test(name),
)).toBe(true);
```

Because JSON cannot encode `NaN` or `Infinity`, test those values by exporting the internal `validateVectorIndexFile(value: unknown)` function and calling it directly with object fixtures.

- [ ] **Step 3: Run the tests and verify failures**

Run `npx vitest run tests/rag/json-vector-index.test.ts`.

Expected: compatibility and corruption assertions fail because Task 6 only throws validation errors.

- [ ] **Step 4: Implement compatibility classification and recovery**

Export:

```ts
export function validateVectorIndexFile(value: unknown): VectorIndexFile;
```

Immediately after JSON parsing, require a plain object and a numeric integer `schemaVersion`. Compare that number with `VECTOR_INDEX_SCHEMA_VERSION` before calling `validateVectorIndexFile()`, so a newer schema is classified as `incompatible` even when this version does not understand its remaining fields. For schema version `1`, call the strict validator and then compare `providerId`, `model`, `chunkSizeChars`, and `overlapChars` in that order. Return an empty `incompatible` state with a concrete warning such as `Vector index incompatible: model changed from old-model to new-model`; do not back up a valid incompatible file.

Wrap parse and structural validation failures in `initialize()` and recover using:

```ts
const backupPath = join(
  dirname(options.filePath),
  `vector-index.corrupt-${Date.now()}.json`,
);
await rename(options.filePath, backupPath);
const warning = `Vector index corrupt: ${message}; backup created at ${backupPath}`;
logger(`[RAG] ${warning}`);
return { status: "corrupt", loadedEntries: 0, warning };
```

The cached initialization promise must resolve to the same result for subsequent calls. A later `addMany()` must write a new valid formal file while preserving the timestamped corrupt backup.

- [ ] **Step 5: Verify and commit**

Run:

```cmd
npx vitest run tests/rag/json-vector-index.test.ts
git add src/main/rag/json-vector-index.ts tests/rag/json-vector-index.test.ts
git commit -m "feat: recover incompatible and corrupt indexes"
```

Expected: every JSON index state and validation case passes.

---

### Task 8: Prove Reuse Across Independent Index Instances

**Files:**

- Create: `tests/rag/vector-index-persistence.test.ts`

**Interfaces:**

- Consumes: the completed `JsonVectorIndex`, hash-aware `VectorRetriever`, fake embedding providers, and temporary files.
- Produces: integration evidence for first-run persistence, restart reuse, changed-text replacement, and removed-chunk pruning.

- [ ] **Step 1: Add shared integration-test fixtures**

Create `tests/rag/vector-index-persistence.test.ts` with `mkdtemp`/`rm` cleanup, the existing `KnowledgeChunk` helper shape, and this factory:

```ts
function persistentIndex(filePath: string, model = "fake-model") {
  return createJsonVectorIndex({
    filePath,
    identity: { providerId: "fake", model, schemaVersion: 1 },
    chunkSizeChars: 600,
    overlapChars: 120,
    logger: vi.fn(),
  });
}
```

- [ ] **Step 2: Prove unchanged document vectors survive a simulated restart**

Add a test using two independent providers, indexes, and retrievers:

```ts
const firstEmbedDocuments = vi.fn(async () => [[1, 0]]);
const firstRetriever = createVectorRetriever(
  {
    id: "fake",
    model: "fake-model",
    embedDocuments: firstEmbedDocuments,
    embedQuery: vi.fn(async () => [1, 0]),
  },
  persistentIndex(filePath),
);
await firstRetriever.retrieve("first query", [chunk("tools", "tool registry")], 1);
expect(firstEmbedDocuments).toHaveBeenCalledOnce();

const secondEmbedDocuments = vi.fn(async () => {
  throw new Error("document embeddings should have been reused");
});
const secondEmbedQuery = vi.fn(async () => [1, 0]);
const secondRetriever = createVectorRetriever(
  {
    id: "fake",
    model: "fake-model",
    embedDocuments: secondEmbedDocuments,
    embedQuery: secondEmbedQuery,
  },
  persistentIndex(filePath),
);
const results = await secondRetriever.retrieve(
  "second query",
  [chunk("tools", "tool registry")],
  1,
);
expect(results[0]?.chunk.id).toBe("tools");
expect(secondEmbedDocuments).not.toHaveBeenCalled();
expect(secondEmbedQuery).toHaveBeenCalledOnce();
```

- [ ] **Step 3: Prove changed and removed chunks update the disk index**

Add another test. The first retriever stores `keep`, `change`, and `remove`. A second retriever receives `keep` unchanged and `change` with new text. Assert:

```ts
expect(secondEmbedDocuments).toHaveBeenCalledOnce();
expect(secondEmbedDocuments).toHaveBeenCalledWith(["new changed text"]);

const saved = JSON.parse(await readFile(filePath, "utf8")) as VectorIndexFile;
expect(saved.entries.map((entry) => entry.chunkId).sort()).toEqual([
  "change",
  "keep",
]);
expect(saved.entries.find((entry) => entry.chunkId === "change")?.textHash).toBe(
  hashText("new changed text"),
);
```

This one test proves unchanged reuse, changed-text re-embedding, and removed-chunk pruning after a restart boundary.

Add a third test that writes with model `old-model`, creates a new index with model `new-model`, and asserts the new provider receives every current chunk in one `embedDocuments()` call. This proves an incompatible model causes a full document-vector rebuild rather than stale reuse.

- [ ] **Step 4: Run the integration test**

Run:

```cmd
npx vitest run tests/rag/vector-index-persistence.test.ts
```

Expected: both restart-boundary scenarios pass without a live Ollama request.

- [ ] **Step 5: Commit**

Run:

```cmd
git add tests/rag/vector-index-persistence.test.ts
git commit -m "test: verify persisted vector reuse"
```

---

### Task 9: Wire Persistent Storage into the Knowledge Base and Tools

**Files:**

- Modify: `src/main/rag/knowledge-base.ts`
- Modify: `src/main/rag/default-knowledge.ts`
- Modify: `src/main/tools/built-in-tools.ts`
- Modify: `tests/rag/knowledge-base.test.ts`
- Modify: `tests/tools/built-in-tools.test.ts`

**Interfaces:**

- Consumes: storage configuration, embedding provider, optional injected index, JSON index, and asynchronous retriever clearing.
- Produces: persistent default runtime assembly without real-profile writes in automated tests.

- [ ] **Step 1: Make the KnowledgeBase clear test asynchronous**

Change `KnowledgeBase.clear` in `src/main/rag/knowledge-base.ts` to:

```ts
clear(): Promise<void>;
```

First update the test to use:

```ts
const clear = vi.fn(async () => undefined);
await knowledgeBase.clear();
expect(clear).toHaveBeenCalledOnce();
```

Run `npx vitest run tests/rag/knowledge-base.test.ts` and expect a failure until the implementation becomes:

```ts
async clear() {
  store.clear();
  await options.vectorRetriever?.clear();
},
```

Add a storage-failure fallback test using a hand-written retriever:

```ts
it("falls back to keywords when persistent index access fails", async () => {
  const knowledgeBase = createKnowledgeBase([], undefined, {
    vectorRetriever: {
      model: "fake-model",
      retrieve: vi.fn(async () => {
        throw new Error("Cannot write vector index");
      }),
      clear: vi.fn(async () => undefined),
    },
  });
  knowledgeBase.addDocument({
    title: "ToolRegistry",
    text: "ToolRegistry registers tools.",
    source: "test",
  });

  const response = await knowledgeBase.search("ToolRegistry");

  expect(response.mode).toBe("keyword-fallback");
  expect(response.warning).toBe("Cannot write vector index");
  expect(response.results).toHaveLength(1);
});
```

- [ ] **Step 2: Define injectable default assembly**

Replace the positional argument of `createDefaultKnowledgeBase` with:

```ts
export interface CreateDefaultKnowledgeBaseOptions {
  embeddingProvider?: EmbeddingProvider;
  vectorIndex?: VectorIndex;
  storageConfig?: RagStorageConfig;
  logger?: (message: string) => void;
}

export function createDefaultKnowledgeBase(
  options: CreateDefaultKnowledgeBaseOptions = {},
): KnowledgeBase {
  const embeddingProvider = options.embeddingProvider
    ?? createOllamaEmbeddingProvider(loadEmbeddingConfig());
  const storageConfig = options.storageConfig ?? loadRagStorageConfig();
  const vectorIndex = options.vectorIndex ?? createJsonVectorIndex({
    filePath: storageConfig.vectorIndexPath,
    identity: {
      providerId: embeddingProvider.id,
      model: embeddingProvider.model,
      schemaVersion: VECTOR_INDEX_SCHEMA_VERSION,
    },
    chunkSizeChars: DEFAULT_CHUNK_SIZE_CHARS,
    overlapChars: DEFAULT_OVERLAP_CHARS,
    logger: options.logger,
  });
  return createKnowledgeBase(DEFAULT_DOCUMENTS, undefined, {
    vectorRetriever: createVectorRetriever(embeddingProvider, vectorIndex),
  });
}
```

Import every referenced type, constant, and factory from its owning module.

- [ ] **Step 3: Pass safe index injection through the Tool Registry**

Extend `CreateDefaultToolRegistryOptions` in `src/main/tools/built-in-tools.ts`:

```ts
export interface CreateDefaultToolRegistryOptions {
  embeddingProvider?: EmbeddingProvider;
  vectorIndex?: VectorIndex;
  storageConfig?: RagStorageConfig;
}
```

Construct the knowledge base with:

```ts
const knowledgeBase = createDefaultKnowledgeBase({
  embeddingProvider: options.embeddingProvider,
  vectorIndex: options.vectorIndex,
  storageConfig: options.storageConfig,
});
```

In the vector-search test, inject `createInMemoryVectorIndex()` together with the fake provider. This guarantees the automated test never writes `vector-index.json` into the user profile.

- [ ] **Step 4: Add an assembly test for the configured JSON path**

In `tests/tools/built-in-tools.test.ts`, create a temporary directory and pass this storage configuration with the fake provider, without passing `vectorIndex`:

```ts
const vectorIndexPath = join(tempDir, "vector-index.json");
const registry = createDefaultToolRegistry({
  embeddingProvider: fakeEmbeddingProvider,
  storageConfig: { dataDir: tempDir, vectorIndexPath },
});
const output = await registry.getById("search_knowledge")?.execute({
  query: "How does ToolRegistry execute tools?",
  topK: 2,
});
expect(await readFile(vectorIndexPath, "utf8")).toContain('"schemaVersion": 1');
```

Assert the output still contains:

```text
retrieval_mode: vector
embedding_model: fake-model
```

Clean the temporary directory in `finally`.

- [ ] **Step 5: Run affected tests and type checking**

Run:

```cmd
npx vitest run tests/rag/knowledge-base.test.ts tests/tools/built-in-tools.test.ts tests/agent/tool-agent.test.ts tests/cli/chat.test.ts
npm run typecheck
```

Expected: all affected tests pass, type checking has no old `VectorIndex` or synchronous `clear()` errors, and no live Ollama call occurs.

- [ ] **Step 6: Commit**

Run:

```cmd
git add src/main/rag/knowledge-base.ts src/main/rag/default-knowledge.ts src/main/tools/built-in-tools.ts tests/rag/knowledge-base.test.ts tests/tools/built-in-tools.test.ts
git commit -m "feat: enable persistent RAG storage by default"
```

---

### Task 10: Document and Verify Phase 6C End to End

**Files:**

- Create: `docs/learning/phase-06c-persistent-vector-index.zh-CN.md`
- Verify: every Phase 6C source and test file.

**Interfaces:**

- Consumes: the completed implementation and its observed test/runtime behavior.
- Produces: a detailed Chinese learning guide and final acceptance evidence.

- [ ] **Step 1: Write the Chinese learning guide from the completed code**

Create `docs/learning/phase-06c-persistent-vector-index.zh-CN.md` with these sections:

```markdown
# Phase 6C：持久化向量索引学习文档

## 1. 为什么 Phase 6B 每次重启都要重新向量化
## 2. 持久化索引在完整 RAG 流程中的位置
## 3. VectorIndex 接口为什么必须独立
## 4. chunkId 与 textHash 为什么必须共同判断
## 5. vector-index.json 每一个字段的含义
## 6. initialize 如何区分 missing、loaded、incompatible 和 corrupt
## 7. JsonVectorIndex 如何验证磁盘数据
## 8. addMany 为什么只保存一次文件
## 9. prune 如何处理新增、修改和删除的文本块
## 10. 原子写入和 Windows 备份恢复流程
## 11. VectorRetriever 如何复用旧向量
## 12. KnowledgeBase 为什么仍然保留关键词回退
## 13. 默认存储目录与 CYRENE_RAG_DATA_DIR
## 14. 如何读懂单元测试和跨实例持久化测试
## 15. 如何手动观察首次索引与重启复用
## 16. 当前 JSON 方案的限制与 Phase 6D 方向
```

For every section, cite the completed TypeScript files, show the relevant short snippet, provide a Python equivalent where it helps, and trace concrete values such as `seed_tool_registry_chunk_0`, its SHA-256 hash, a 2560-dimensional vector, and the resulting JSON entry. Explain concepts and implementation details; do not copy the design specification verbatim.

- [ ] **Step 2: Run all automated tests**

Run:

```cmd
npm test
```

Expected: every test passes; no test attempts a request to `127.0.0.1:11434` and no test creates files under the real home directory.

- [ ] **Step 3: Run static and production-build verification**

Run:

```cmd
npm run typecheck
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 4: Run the existing real Ollama smoke test**

Run:

```cmd
npm run test:embedding
```

Expected output includes:

```text
provider: ollama
model: qwen3-embedding:4b
dimensions: 2560
semantic comparison: PASS
```

If Ollama is unavailable, preserve the exact automated-test result and report the external prerequisite failure without weakening application error handling.

- [ ] **Step 5: Manually verify persistence through Electron**

Set a temporary manual data directory before launching so existing user data is untouched:

```cmd
set CYRENE_RAG_DATA_DIR=%TEMP%\cyrene-rag-phase6c-manual
npm run dev:electron
```

Send:

```text
请搜索知识库并说明 Agent 是怎样注册和执行工具的。
```

Expected first-run terminal logs:

```text
[RAG] vector index missing
[RAG] vector index saved: 3 entries
```

Close Electron, launch it again with the same environment variable, and send the same question. Expected second-run logs:

```text
[RAG] vector index loaded: 3 entries
```

The tool output in both runs must include `retrieval_mode: vector` and `embedding_model: qwen3-embedding:4b`. Inspect `%TEMP%\cyrene-rag-phase6c-manual\vector-index.json` and confirm it contains schema, embedding, chunking, hashes, and vectors.

- [ ] **Step 6: Commit documentation**

Run:

```cmd
git add docs/learning/phase-06c-persistent-vector-index.zh-CN.md
git commit -m "docs: explain persistent vector indexing"
```

- [ ] **Step 7: Inspect final scope**

Run:

```cmd
git status --short
git log --oneline -12
```

Expected: no uncommitted Phase 6C files remain and commits match the task boundaries in this plan.

---

## Final Acceptance Checklist

- [ ] The System Prompt contains only agent-wide rules; Tool Schema owns semantic query formatting.
- [ ] Seed knowledge accurately describes Phase 6B and Phase 6C.
- [ ] Default storage resolves to `~/.cyrene-agent-replica-lab/rag/vector-index.json`.
- [ ] `CYRENE_RAG_DATA_DIR` overrides the default directory.
- [ ] `VectorRetriever` imports only the shared `VectorIndex` contract, not JSON or filesystem code.
- [ ] Both in-memory and JSON indexes implement the same asynchronous interface.
- [ ] A chunk vector is reusable only when both ID and SHA-256 text hash match.
- [ ] One missing-chunk batch produces one `embedDocuments()` call and one persistent save.
- [ ] Unchanged chunks are reused by a new process/index instance.
- [ ] New chunks alone are embedded incrementally.
- [ ] Modified chunks alone are re-embedded, even when their IDs are unchanged.
- [ ] Removed chunks are pruned from memory and disk.
- [ ] Provider, model, schema, or chunking changes prevent old-vector reuse.
- [ ] Malformed or invalid index data is backed up and rebuilt without crashing the Agent.
- [ ] Atomic replacement never deletes the only formal index before a backup exists.
- [ ] `KnowledgeBase.clear()` clears both knowledge and persistent vector state asynchronously.
- [ ] New Chat still clears only chat history, not the knowledge index.
- [ ] Keyword fallback still reports vector initialization or persistence errors.
- [ ] Automated tests use temporary paths and fake providers only.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` pass.
- [ ] Real Ollama smoke testing still reports 2560 dimensions and semantic comparison PASS.
- [ ] The Chinese learning guide explains the final implementation with TypeScript and Python comparisons.
