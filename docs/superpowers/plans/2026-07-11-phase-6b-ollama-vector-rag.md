# Phase 6B Ollama Vector RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real local vector retrieval through Ollama `qwen3-embedding:4b`, while preserving keyword search as an explicit failure fallback.

**Architecture:** The RAG layer depends on a small `EmbeddingProvider` interface. An Ollama adapter produces embeddings, an in-memory index stores vectors by chunk id, and a vector retriever performs linear cosine-similarity search. `KnowledgeBase.search()` becomes asynchronous and reports whether vector retrieval or keyword fallback produced the result.

**Tech Stack:** TypeScript 5.7, Node.js 22, native `fetch`, Ollama `/api/embed`, Vitest 2, Electron 43.

## Global Constraints

- Keep `qwen3-embedding:4b` as the default embedding model.
- Keep DeepSeek/OpenAI-compatible chat configuration independent from embedding configuration.
- Do not add an npm runtime dependency in Phase 6B.
- `npm test` must not require Ollama, a downloaded model, an API key, or network access.
- Use full cosine similarity; do not assume embeddings are normalized.
- Generate document vectors lazily and incrementally on search.
- Fall back to keyword retrieval when vector retrieval fails, and expose the failure reason.
- Keep vector storage in memory only; persistence belongs to Phase 6C.
- Do not implement BM25, hybrid score fusion, reranking, IVF, HNSW, file import, model switching UI, or an embedded Transformers.js model.
- Preserve the current Agent Loop, Vendor Adapter, IPC, preload, and renderer contracts.

---

## File Map

**Create:**

- `src/main/config/embedding-config.ts` - load and validate Ollama embedding settings.
- `src/main/rag/embedding-provider.ts` - define the provider contract.
- `src/main/rag/vector-math.ts` - validate vectors and calculate cosine similarity.
- `src/main/rag/in-memory-vector-index.ts` - store vectors by chunk id and enforce one dimension.
- `src/main/rag/ollama-embedding-provider.ts` - call and validate Ollama `/api/embed`.
- `src/main/rag/vector-retriever.ts` - index missing chunks and rank them against a query.
- `src/cli/test-embedding.ts` - perform a real local Ollama smoke test.
- `tests/config/embedding-config.test.ts` - cover defaults and overrides.
- `tests/rag/vector-math.test.ts` - cover vector validation and similarity.
- `tests/rag/in-memory-vector-index.test.ts` - cover storage, copies, dimensions, and clear.
- `tests/rag/ollama-embedding-provider.test.ts` - cover HTTP requests and response failures.
- `tests/rag/vector-retriever.test.ts` - cover lazy indexing, incremental indexing, and ranking.
- `docs/learning/phase-06b-ollama-vector-rag.zh-CN.md` - explain the completed phase in Chinese.

**Modify:**

- `src/main/rag/rag-types.ts` - add retrieval response metadata.
- `src/main/rag/knowledge-base.ts` - orchestrate asynchronous vector search and keyword fallback.
- `src/main/rag/default-knowledge.ts` - construct the default vector-aware knowledge base.
- `src/main/tools/built-in-tools.ts` - await search and format retrieval diagnostics.
- `src/cli/chat.ts` - keep runtime registry construction explicit and testable.
- `tests/rag/knowledge-base.test.ts` - update the async contract and add fallback coverage.
- `tests/tools/built-in-tools.test.ts` - inject a fake provider and assert vector diagnostics.
- `tests/agent/tool-agent.test.ts` - preserve the four-tool Agent Loop contract.
- `tests/cli/chat.test.ts` - preserve runtime construction tests.
- `package.json` - add `test:embedding`.

---

### Task 0: Establish the Phase 6A Baseline

**Files:**

- Existing changes only: `src/main/rag/**`, Phase 6A tests/docs, and the existing Phase 6A modifications to built-in tool tests.

**Interfaces:**

- Consumes: the current uncommitted Phase 6A implementation.
- Produces: a tested Git baseline before Phase 6B changes begin.

- [ ] **Step 1: Run the current Phase 6A test suite**

Run:

```cmd
npm test
```

Expected: all current tests pass, including `tests/rag/chunk-text.test.ts`, `tests/rag/keyword-retriever.test.ts`, and `tests/rag/knowledge-base.test.ts`.

- [ ] **Step 2: Run current static verification**

Run:

```cmd
npm run typecheck
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 3: Commit only the Phase 6A baseline files**

Run:

```cmd
git add docs/learning/phase-06a-minimal-rag.zh-CN.md docs/superpowers/plans/2026-07-09-phase-6a-minimal-rag.md docs/superpowers/specs/2026-07-09-phase-6a-minimal-rag-design.zh-CN.md src/main/rag src/main/tools/built-in-tools.ts tests/rag tests/agent/tool-agent.test.ts tests/cli/chat.test.ts tests/tools/built-in-tools.test.ts
git commit -m "feat: add minimal keyword RAG"
```

Expected: the commit contains the Phase 6A implementation and does not modify the already committed Phase 6B design document.

---

### Task 1: Add Embedding Configuration and Provider Contract

**Files:**

- Create: `src/main/config/embedding-config.ts`
- Create: `src/main/rag/embedding-provider.ts`
- Create: `tests/config/embedding-config.test.ts`

**Interfaces:**

- Consumes: `NodeJS.ProcessEnv`.
- Produces: `EmbeddingConfig`, `loadEmbeddingConfig()`, and `EmbeddingProvider`.

- [ ] **Step 1: Write the failing configuration tests**

Create `tests/config/embedding-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadEmbeddingConfig } from "../../src/main/config/embedding-config.js";

describe("loadEmbeddingConfig", () => {
  it("uses the Phase 6B Ollama defaults", () => {
    expect(loadEmbeddingConfig({})).toEqual({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3-embedding:4b",
      requestTimeoutMs: 120_000,
    });
  });

  it("reads environment overrides and removes a trailing slash", () => {
    expect(
      loadEmbeddingConfig({
        CYRENE_EMBEDDING_PROVIDER: "ollama",
        CYRENE_OLLAMA_BASE_URL: "http://localhost:9999/",
        CYRENE_EMBEDDING_MODEL: "custom-embedding",
        CYRENE_EMBEDDING_TIMEOUT_MS: "45000",
      }),
    ).toEqual({
      provider: "ollama",
      baseUrl: "http://localhost:9999",
      model: "custom-embedding",
      requestTimeoutMs: 45_000,
    });
  });

  it("rejects unsupported providers and invalid timeouts", () => {
    expect(() =>
      loadEmbeddingConfig({ CYRENE_EMBEDDING_PROVIDER: "cloud" }),
    ).toThrow("Unsupported embedding provider: cloud");

    expect(() =>
      loadEmbeddingConfig({ CYRENE_EMBEDDING_TIMEOUT_MS: "zero" }),
    ).toThrow("CYRENE_EMBEDDING_TIMEOUT_MS must be a positive integer");
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run:

```cmd
npx vitest run tests/config/embedding-config.test.ts
```

Expected: FAIL because `src/main/config/embedding-config.ts` does not exist.

- [ ] **Step 3: Implement the configuration loader**

Create `src/main/config/embedding-config.ts`:

```ts
export interface EmbeddingConfig {
  provider: "ollama";
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return typeof env[key] === "string" ? env[key]!.trim() : "";
}

function removeTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadEmbeddingConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingConfig {
  const provider = readEnv(env, "CYRENE_EMBEDDING_PROVIDER") || "ollama";
  if (provider !== "ollama") {
    throw new Error(`Unsupported embedding provider: ${provider}`);
  }

  const timeoutText = readEnv(env, "CYRENE_EMBEDDING_TIMEOUT_MS");
  const requestTimeoutMs = timeoutText ? Number(timeoutText) : 120_000;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("CYRENE_EMBEDDING_TIMEOUT_MS must be a positive integer");
  }

  return {
    provider,
    baseUrl: removeTrailingSlashes(
      readEnv(env, "CYRENE_OLLAMA_BASE_URL") || "http://127.0.0.1:11434",
    ),
    model: readEnv(env, "CYRENE_EMBEDDING_MODEL") || "qwen3-embedding:4b",
    requestTimeoutMs,
  };
}
```

- [ ] **Step 4: Define the provider contract**

Create `src/main/rag/embedding-provider.ts`:

```ts
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;

  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}
```

- [ ] **Step 5: Verify and commit**

Run:

```cmd
npx vitest run tests/config/embedding-config.test.ts
npm run typecheck
git add src/main/config/embedding-config.ts src/main/rag/embedding-provider.ts tests/config/embedding-config.test.ts
git commit -m "feat: add embedding provider configuration"
```

Expected: 3 configuration tests pass and typecheck exits with code `0`.

---

### Task 2: Add Safe Vector Mathematics

**Files:**

- Create: `src/main/rag/vector-math.ts`
- Create: `tests/rag/vector-math.test.ts`

**Interfaces:**

- Consumes: two `number[]` vectors.
- Produces: `validateVector(vector, label)` and `cosineSimilarity(a, b)`.

- [ ] **Step 1: Write the failing vector math tests**

Create `tests/rag/vector-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  validateVector,
} from "../../src/main/rag/vector-math.js";

describe("validateVector", () => {
  it("accepts a finite non-empty vector", () => {
    expect(() => validateVector([1, 2, 3], "test vector")).not.toThrow();
  });

  it("rejects empty and non-finite vectors", () => {
    expect(() => validateVector([], "test vector")).toThrow(
      "test vector must not be empty",
    );
    expect(() => validateVector([1, Number.NaN], "test vector")).toThrow(
      "test vector contains a non-finite value at index 1",
    );
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for equal-direction vectors", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("rejects dimension mismatch and zero vectors", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(
      "Vector dimensions must match: 1 !== 2",
    );
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow(
      "Cosine similarity is undefined for a zero vector",
    );
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```cmd
npx vitest run tests/rag/vector-math.test.ts
```

Expected: FAIL because `vector-math.ts` does not exist.

- [ ] **Step 3: Implement vector validation and full cosine similarity**

Create `src/main/rag/vector-math.ts`:

```ts
export function validateVector(vector: number[], label: string): void {
  if (vector.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  for (let index = 0; index < vector.length; index += 1) {
    if (!Number.isFinite(vector[index])) {
      throw new Error(`${label} contains a non-finite value at index ${index}`);
    }
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  validateVector(a, "First vector");
  validateVector(b, "Second vector");

  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    throw new Error("Cosine similarity is undefined for a zero vector");
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

- [ ] **Step 4: Verify and commit**

Run:

```cmd
npx vitest run tests/rag/vector-math.test.ts
npm run typecheck
git add src/main/rag/vector-math.ts tests/rag/vector-math.test.ts
git commit -m "feat: add cosine similarity utilities"
```

Expected: 5 tests pass.

---

### Task 3: Add the In-Memory Vector Index

**Files:**

- Create: `src/main/rag/in-memory-vector-index.ts`
- Create: `tests/rag/in-memory-vector-index.test.ts`

**Interfaces:**

- Consumes: chunk ids and validated vectors.
- Produces: `VectorIndex` and `createInMemoryVectorIndex()`.

- [ ] **Step 1: Write the failing index tests**

Create `tests/rag/in-memory-vector-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";

describe("createInMemoryVectorIndex", () => {
  it("stores and returns a defensive copy", () => {
    const index = createInMemoryVectorIndex();
    const source = [1, 2, 3];
    index.add("chunk_1", source);
    source[0] = 99;

    const firstRead = index.get("chunk_1");
    expect(firstRead).toEqual([1, 2, 3]);
    firstRead![1] = 88;
    expect(index.get("chunk_1")).toEqual([1, 2, 3]);
  });

  it("tracks ids and rejects dimension changes", () => {
    const index = createInMemoryVectorIndex();
    index.add("chunk_1", [1, 2]);

    expect(index.has("chunk_1")).toBe(true);
    expect(index.has("missing")).toBe(false);
    expect(() => index.add("chunk_2", [1, 2, 3])).toThrow(
      "Vector dimension mismatch: expected 2, received 3",
    );
  });

  it("clears vectors and resets the dimension", () => {
    const index = createInMemoryVectorIndex();
    index.add("chunk_1", [1, 2]);
    index.clear();
    index.add("chunk_2", [1, 2, 3]);

    expect(index.has("chunk_1")).toBe(false);
    expect(index.get("chunk_2")).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```cmd
npx vitest run tests/rag/in-memory-vector-index.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the index**

Create `src/main/rag/in-memory-vector-index.ts`:

```ts
import { validateVector } from "./vector-math.js";

export interface VectorIndex {
  has(chunkId: string): boolean;
  add(chunkId: string, vector: number[]): void;
  get(chunkId: string): number[] | undefined;
  clear(): void;
}

export function createInMemoryVectorIndex(): VectorIndex {
  const vectors = new Map<string, number[]>();
  let dimensions: number | undefined;

  return {
    has(chunkId) {
      return vectors.has(chunkId);
    },

    add(chunkId, vector) {
      validateVector(vector, `Vector for ${chunkId}`);
      if (dimensions !== undefined && vector.length !== dimensions) {
        throw new Error(
          `Vector dimension mismatch: expected ${dimensions}, received ${vector.length}`,
        );
      }
      dimensions ??= vector.length;
      vectors.set(chunkId, [...vector]);
    },

    get(chunkId) {
      const vector = vectors.get(chunkId);
      return vector ? [...vector] : undefined;
    },

    clear() {
      vectors.clear();
      dimensions = undefined;
    },
  };
}
```

- [ ] **Step 4: Verify and commit**

Run:

```cmd
npx vitest run tests/rag/in-memory-vector-index.test.ts
npm run typecheck
git add src/main/rag/in-memory-vector-index.ts tests/rag/in-memory-vector-index.test.ts
git commit -m "feat: add in-memory vector index"
```

Expected: 3 index tests pass.

---

### Task 4: Implement the Ollama Embedding Provider

**Files:**

- Create: `src/main/rag/ollama-embedding-provider.ts`
- Create: `tests/rag/ollama-embedding-provider.test.ts`

**Interfaces:**

- Consumes: `EmbeddingConfig`, an optional `fetch` implementation, and text inputs.
- Produces: `createOllamaEmbeddingProvider(config, fetchImpl?)` implementing `EmbeddingProvider`.

- [ ] **Step 1: Write failing tests for document and query requests**

Create `tests/rag/ollama-embedding-provider.test.ts` with a local response helper and these cases:

```ts
import { describe, expect, it, vi } from "vitest";
import { createOllamaEmbeddingProvider } from "../../src/main/rag/ollama-embedding-provider.js";

const config = {
  provider: "ollama" as const,
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen3-embedding:4b",
  requestTimeoutMs: 1_000,
};

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

describe("createOllamaEmbeddingProvider", () => {
  it("batch-embeds documents without a query instruction", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ embeddings: [[1, 0], [0, 1]] }),
    );
    const provider = createOllamaEmbeddingProvider(
      config,
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.embedDocuments(["doc one", "doc two"])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      model: "qwen3-embedding:4b",
      input: ["doc one", "doc two"],
    });
  });

  it("adds the retrieval instruction to queries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ embeddings: [[0.5, 0.5]] }),
    );
    const provider = createOllamaEmbeddingProvider(
      config,
      fetchMock as unknown as typeof fetch,
    );

    await provider.embedQuery("ToolRegistry 是什么？");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.input).toEqual([
      "Instruct: Retrieve relevant passages from the local knowledge base that answer the user's question.\nQuery: ToolRegistry 是什么？",
    ]);
  });

  it("rejects HTTP errors and invalid batch sizes", async () => {
    const httpFailure = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () => jsonResponse({ error: "model missing" }, 404)) as unknown as typeof fetch,
    );
    await expect(httpFailure.embedQuery("hello")).rejects.toThrow(
      "Ollama embedding request failed: HTTP 404",
    );

    const invalidBatch = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () => jsonResponse({ embeddings: [[1, 0]] })) as unknown as typeof fetch,
    );
    await expect(invalidBatch.embedDocuments(["one", "two"])).rejects.toThrow(
      "Ollama returned 1 embeddings for 2 inputs",
    );
  });

  it("rejects inconsistent and non-finite vectors", async () => {
    const inconsistent = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () => jsonResponse({ embeddings: [[1, 0], [1, 0, 2]] })) as unknown as typeof fetch,
    );
    await expect(inconsistent.embedDocuments(["one", "two"])).rejects.toThrow(
      "Ollama returned inconsistent vector dimensions",
    );

    const nonFinite = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () => jsonResponse({ embeddings: [[Number.NaN, 1]] })) as unknown as typeof fetch,
    );
    await expect(nonFinite.embedQuery("hello")).rejects.toThrow(
      "Ollama embedding 0 contains a non-finite value at index 0",
    );
  });

  it("rejects responses without embeddings", async () => {
    const provider = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () => jsonResponse({ model: "qwen3-embedding:4b" })) as unknown as typeof fetch,
    );

    await expect(provider.embedQuery("hello")).rejects.toThrow(
      "Ollama response does not contain an embeddings array",
    );
  });

  it("turns an aborted request into a clear timeout error", async () => {
    const timeoutConfig = { ...config, requestTimeoutMs: 1 };
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const provider = createOllamaEmbeddingProvider(
      timeoutConfig,
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.embedQuery("hello")).rejects.toThrow(
      "Ollama embedding request timed out after 1ms",
    );
  });

  it("turns a network failure into a clear connection error", async () => {
    const provider = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    );

    await expect(provider.embedQuery("hello")).rejects.toThrow(
      "Cannot connect to Ollama at http://127.0.0.1:11434: fetch failed",
    );
  });
});
```

- [ ] **Step 2: Run the provider tests and verify failure**

Run:

```cmd
npx vitest run tests/rag/ollama-embedding-provider.test.ts
```

Expected: FAIL because the provider module does not exist.

- [ ] **Step 3: Implement the Ollama provider**

Create `src/main/rag/ollama-embedding-provider.ts`:

```ts
import type { EmbeddingConfig } from "../config/embedding-config.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { validateVector } from "./vector-math.js";

const QUERY_INSTRUCTION =
  "Instruct: Retrieve relevant passages from the local knowledge base that answer the user's question.";

interface OllamaEmbedResponse {
  embeddings?: unknown;
}

function validateEmbeddings(value: unknown, inputCount: number): number[][] {
  if (!Array.isArray(value)) {
    throw new Error("Ollama response does not contain an embeddings array");
  }
  if (value.length !== inputCount) {
    throw new Error(`Ollama returned ${value.length} embeddings for ${inputCount} inputs`);
  }

  const vectors = value.map((candidate, index) => {
    if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === "number")) {
      throw new Error(`Ollama embedding ${index} must be a number array`);
    }
    const vector = candidate as number[];
    validateVector(vector, `Ollama embedding ${index}`);
    return vector;
  });

  const dimensions = vectors[0]?.length;
  if (vectors.some((vector) => vector.length !== dimensions)) {
    throw new Error("Ollama returned inconsistent vector dimensions");
  }
  return vectors;
}

export function createOllamaEmbeddingProvider(
  config: EmbeddingConfig,
  fetchImpl: typeof fetch = fetch,
): EmbeddingProvider {
  async function embedInputs(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.model, input: inputs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = body ? ` - ${body.slice(0, 300)}` : "";
        throw new Error(
          `Ollama embedding request failed: HTTP ${response.status}${detail}`,
        );
      }

      let data: OllamaEmbedResponse;
      try {
        data = (await response.json()) as OllamaEmbedResponse;
      } catch {
        throw new Error("Ollama embedding response is not valid JSON");
      }
      return validateEmbeddings(data.embeddings, inputs.length);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Ollama embedding request timed out after ${config.requestTimeoutMs}ms`,
        );
      }
      if (error instanceof TypeError) {
        throw new Error(
          `Cannot connect to Ollama at ${config.baseUrl}: ${error.message}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    id: "ollama",
    model: config.model,
    embedDocuments: embedInputs,
    async embedQuery(query) {
      const [vector] = await embedInputs([
        `${QUERY_INSTRUCTION}\nQuery: ${query.trim()}`,
      ]);
      return vector;
    },
  };
}
```

- [ ] **Step 4: Verify and commit**

Run:

```cmd
npx vitest run tests/rag/ollama-embedding-provider.test.ts
npm run typecheck
git add src/main/rag/ollama-embedding-provider.ts tests/rag/ollama-embedding-provider.test.ts
git commit -m "feat: add Ollama embedding provider"
```

Expected: 7 provider tests pass.

---

### Task 5: Implement Lazy Incremental Vector Retrieval

**Files:**

- Create: `src/main/rag/vector-retriever.ts`
- Create: `tests/rag/vector-retriever.test.ts`
- Modify: `src/main/rag/rag-types.ts`

**Interfaces:**

- Consumes: `EmbeddingProvider`, `VectorIndex`, `KnowledgeChunk[]`, a query, and `topK`.
- Produces: `VectorRetriever`, `createVectorRetriever()`, optional `matchedTerms`, and `KnowledgeSearchResponse`.

- [ ] **Step 1: Extend the shared RAG result types**

Modify the search result section of `src/main/rag/rag-types.ts` to read:

```ts
export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms?: string[];
}

export interface KnowledgeSearchResponse {
  mode: "vector" | "keyword-fallback";
  model?: string;
  results: KnowledgeSearchResult[];
  warning?: string;
}
```

- [ ] **Step 2: Write the failing vector retriever tests**

Create `tests/rag/vector-retriever.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";
import type { KnowledgeChunk } from "../../src/main/rag/rag-types.js";
import { createVectorRetriever } from "../../src/main/rag/vector-retriever.js";

function chunk(id: string, text: string): KnowledgeChunk {
  return {
    id,
    documentId: "doc",
    title: id,
    text,
    source: "test",
    index: 0,
  };
}

describe("createVectorRetriever", () => {
  it("indexes documents once and ranks by cosine similarity", async () => {
    const embedDocuments = vi.fn(async () => [[1, 0], [0, 1]]);
    const embedQuery = vi.fn(async () => [0.9, 0.1]);
    const provider: EmbeddingProvider = {
      id: "fake",
      model: "fake-model",
      embedDocuments,
      embedQuery,
    };
    const retriever = createVectorRetriever(
      provider,
      createInMemoryVectorIndex(),
    );
    const chunks = [chunk("tools", "tool registry"), chunk("weather", "sunny")];

    const first = await retriever.retrieve("how are tools registered", chunks, 2);
    const second = await retriever.retrieve("tools again", chunks, 1);

    expect(first.map((result) => result.chunk.id)).toEqual(["tools", "weather"]);
    expect(second[0]?.chunk.id).toBe("tools");
    expect(embedDocuments).toHaveBeenCalledOnce();
    expect(embedDocuments).toHaveBeenCalledWith(["tool registry", "sunny"]);
    expect(embedQuery).toHaveBeenCalledTimes(2);
  });

  it("only embeds chunks added after the first search", async () => {
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
    const retriever = createVectorRetriever(
      provider,
      createInMemoryVectorIndex(),
    );

    await retriever.retrieve("query", [chunk("first", "first text")], 1);
    await retriever.retrieve(
      "query",
      [chunk("first", "first text"), chunk("second", "second text")],
      2,
    );

    expect(embedDocuments.mock.calls).toEqual([
      [["first text"]],
      [["second text"]],
    ]);
  });

  it("returns empty results without calling the provider for empty input", async () => {
    const provider: EmbeddingProvider = {
      id: "fake",
      model: "fake-model",
      embedDocuments: vi.fn(async () => []),
      embedQuery: vi.fn(async () => [1, 0]),
    };
    const retriever = createVectorRetriever(
      provider,
      createInMemoryVectorIndex(),
    );

    await expect(retriever.retrieve(" ", [chunk("one", "text")], 5)).resolves.toEqual([]);
    await expect(retriever.retrieve("query", [], 5)).resolves.toEqual([]);
    await expect(retriever.retrieve("query", [chunk("one", "text")], 0)).resolves.toEqual([]);
    expect(provider.embedDocuments).not.toHaveBeenCalled();
    expect(provider.embedQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests and verify failure**

Run:

```cmd
npx vitest run tests/rag/vector-retriever.test.ts
```

Expected: FAIL because `vector-retriever.ts` does not exist.

- [ ] **Step 4: Implement the retriever**

Create `src/main/rag/vector-retriever.ts`:

```ts
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { VectorIndex } from "./in-memory-vector-index.js";
import type { KnowledgeChunk, KnowledgeSearchResult } from "./rag-types.js";
import { cosineSimilarity } from "./vector-math.js";

export interface VectorRetriever {
  readonly model: string;
  retrieve(
    query: string,
    chunks: KnowledgeChunk[],
    topK?: number,
  ): Promise<KnowledgeSearchResult[]>;
  clear(): void;
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

      const missingChunks = chunks.filter((chunk) => !index.has(chunk.id));
      if (missingChunks.length > 0) {
        const vectors = await provider.embedDocuments(
          missingChunks.map((chunk) => chunk.text),
        );
        if (vectors.length !== missingChunks.length) {
          throw new Error(
            `Embedding provider returned ${vectors.length} vectors for ${missingChunks.length} chunks`,
          );
        }
        missingChunks.forEach((chunk, chunkIndex) => {
          index.add(chunk.id, vectors[chunkIndex]);
        });
      }

      const queryVector = await provider.embedQuery(normalizedQuery);
      return chunks
        .map((chunk) => {
          const vector = index.get(chunk.id);
          if (!vector) throw new Error(`Missing vector for chunk: ${chunk.id}`);
          return {
            chunk,
            score: cosineSimilarity(queryVector, vector),
          };
        })
        .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
        .slice(0, topK);
    },

    clear() {
      index.clear();
    },
  };
}
```

- [ ] **Step 5: Verify and commit**

Run:

```cmd
npx vitest run tests/rag/vector-retriever.test.ts tests/rag/keyword-retriever.test.ts
npm run typecheck
git add src/main/rag/rag-types.ts src/main/rag/vector-retriever.ts tests/rag/vector-retriever.test.ts
git commit -m "feat: add lazy vector retrieval"
```

Expected: vector and keyword retriever tests pass.

---

### Task 6: Integrate Vector Retrieval into KnowledgeBase

**Files:**

- Modify: `src/main/rag/knowledge-base.ts`
- Modify: `src/main/rag/default-knowledge.ts`
- Modify: `tests/rag/knowledge-base.test.ts`

**Interfaces:**

- Consumes: optional `VectorRetriever` through `CreateKnowledgeBaseOptions`.
- Produces: asynchronous `KnowledgeBase.search()` returning `KnowledgeSearchResponse`.

- [ ] **Step 1: Replace the KnowledgeBase tests with async vector and fallback coverage**

Update `tests/rag/knowledge-base.test.ts` so its four existing tests await `search()`, then add these two explicit cases:

```ts
import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";
import { createInMemoryVectorIndex } from "../../src/main/rag/in-memory-vector-index.js";
import { createKnowledgeBase } from "../../src/main/rag/knowledge-base.js";
import { createVectorRetriever } from "../../src/main/rag/vector-retriever.js";

function createFakeProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    id: "fake",
    model: "fake-model",
    embedDocuments: async (texts) => texts.map((_, index) => [index === 0 ? 1 : 0, index === 0 ? 0 : 1]),
    embedQuery: async () => [1, 0],
    ...overrides,
  };
}

describe("createKnowledgeBase", () => {
  it("adds documents and searches their chunks with vectors", async () => {
    const retriever = createVectorRetriever(
      createFakeProvider(),
      createInMemoryVectorIndex(),
    );
    const knowledgeBase = createKnowledgeBase([], undefined, { vectorRetriever: retriever });
    knowledgeBase.addDocument({
      title: "Agent Tools",
      text: "The agent can call tools through the ToolRegistry.",
      source: "test",
    });

    const response = await knowledgeBase.search("How are tools registered?", 3);

    expect(response.mode).toBe("vector");
    expect(response.model).toBe("fake-model");
    expect(response.results[0]?.chunk.title).toBe("Agent Tools");
  });

  it("loads initial documents", async () => {
    const knowledgeBase = createKnowledgeBase([
      {
        id: "initial_doc",
        title: "Initial Knowledge",
        text: "RAG means retrieval augmented generation.",
        source: "seed",
      },
    ]);

    const response = await knowledgeBase.search("retrieval");
    expect(response.mode).toBe("keyword-fallback");
    expect(response.results).toHaveLength(1);
  });

  it("clears documents and vector state", async () => {
    const clear = vi.fn();
    const vectorRetriever = {
      model: "fake-model",
      retrieve: vi.fn(async () => []),
      clear,
    };
    const knowledgeBase = createKnowledgeBase([], undefined, { vectorRetriever });
    knowledgeBase.addDocument({ title: "Temporary", text: "disappear", source: "test" });

    knowledgeBase.clear();
    const response = await knowledgeBase.search("disappear");

    expect(clear).toHaveBeenCalledOnce();
    expect(response.results).toEqual([]);
  });

  it("creates stable generated document ids", () => {
    const knowledgeBase = createKnowledgeBase();
    const first = knowledgeBase.addDocument({ title: "First", text: "alpha", source: "test" });
    const second = knowledgeBase.addDocument({ title: "Second", text: "beta", source: "test" });
    expect(first[0].documentId).toBe("doc_1");
    expect(second[0].documentId).toBe("doc_2");
  });

  it("falls back to keyword search and preserves the vector error", async () => {
    const provider = createFakeProvider({
      embedDocuments: async () => {
        throw new Error("Ollama is offline");
      },
    });
    const knowledgeBase = createKnowledgeBase([], undefined, {
      vectorRetriever: createVectorRetriever(provider, createInMemoryVectorIndex()),
    });
    knowledgeBase.addDocument({
      title: "ToolRegistry",
      text: "ToolRegistry registers tools.",
      source: "test",
    });

    const response = await knowledgeBase.search("ToolRegistry");

    expect(response.mode).toBe("keyword-fallback");
    expect(response.warning).toBe("Ollama is offline");
    expect(response.results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run KnowledgeBase tests and verify contract failures**

Run:

```cmd
npx vitest run tests/rag/knowledge-base.test.ts
```

Expected: FAIL because `search()` is synchronous and no vector retriever option exists.

- [ ] **Step 3: Implement asynchronous KnowledgeBase orchestration**

Modify `src/main/rag/knowledge-base.ts` to expose:

```ts
import { searchChunksByKeyword } from "./keyword-retriever.js";
import { createInMemoryKnowledgeStore, type KnowledgeStore } from "./knowledge-store.js";
import type { KnowledgeChunk, KnowledgeDocument, KnowledgeSearchResponse } from "./rag-types.js";
import type { VectorRetriever } from "./vector-retriever.js";

export interface AddKnowledgeDocumentInput {
  id?: string;
  title: string;
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateKnowledgeBaseOptions {
  vectorRetriever?: VectorRetriever;
}

export interface KnowledgeBase {
  addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[];
  search(query: string, topK?: number): Promise<KnowledgeSearchResponse>;
  clear(): void;
}

export function createKnowledgeBase(
  initialDocuments: KnowledgeDocument[] = [],
  store: KnowledgeStore = createInMemoryKnowledgeStore(),
  options: CreateKnowledgeBaseOptions = {},
): KnowledgeBase {
  let nextDocumentNumber = 1;

  function addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[] {
    const id = input.id ?? `doc_${nextDocumentNumber}`;
    if (!input.id) nextDocumentNumber += 1;
    return store.addDocument({
      id,
      title: input.title,
      text: input.text,
      source: input.source ?? "local",
      metadata: input.metadata,
    });
  }

  for (const document of initialDocuments) addDocument(document);

  return {
    addDocument,

    async search(query, topK = 5) {
      const chunks = store.getChunks();
      if (options.vectorRetriever) {
        try {
          return {
            mode: "vector",
            model: options.vectorRetriever.model,
            results: await options.vectorRetriever.retrieve(query, chunks, topK),
          };
        } catch (error) {
          return {
            mode: "keyword-fallback",
            results: searchChunksByKeyword(query, chunks, { topK }),
            warning: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        mode: "keyword-fallback",
        results: searchChunksByKeyword(query, chunks, { topK }),
        warning: "Vector retriever is not configured",
      };
    },

    clear() {
      store.clear();
      options.vectorRetriever?.clear();
    },
  };
}
```

- [ ] **Step 4: Wire the default knowledge base to Ollama**

Update `src/main/rag/default-knowledge.ts` imports and factory while preserving `DEFAULT_DOCUMENTS` exactly:

```ts
import { loadEmbeddingConfig } from "../config/embedding-config.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { createInMemoryVectorIndex } from "./in-memory-vector-index.js";
import { createKnowledgeBase, type KnowledgeBase } from "./knowledge-base.js";
import { createOllamaEmbeddingProvider } from "./ollama-embedding-provider.js";
import type { KnowledgeDocument } from "./rag-types.js";
import { createVectorRetriever } from "./vector-retriever.js";

// Keep DEFAULT_DOCUMENTS unchanged here.

export function createDefaultKnowledgeBase(
  embeddingProvider: EmbeddingProvider = createOllamaEmbeddingProvider(
    loadEmbeddingConfig(),
  ),
): KnowledgeBase {
  const vectorRetriever = createVectorRetriever(
    embeddingProvider,
    createInMemoryVectorIndex(),
  );
  return createKnowledgeBase(DEFAULT_DOCUMENTS, undefined, { vectorRetriever });
}
```

- [ ] **Step 5: Verify and commit**

Run:

```cmd
npx vitest run tests/rag
npm run typecheck
git add src/main/rag/knowledge-base.ts src/main/rag/default-knowledge.ts tests/rag/knowledge-base.test.ts
git commit -m "feat: integrate vector retrieval into knowledge base"
```

Expected: all RAG tests pass.

---

### Task 7: Integrate Vector Diagnostics into `search_knowledge`

**Files:**

- Modify: `src/main/tools/built-in-tools.ts`
- Modify: `tests/tools/built-in-tools.test.ts`
- Verify: `tests/agent/tool-agent.test.ts`
- Verify: `tests/cli/chat.test.ts`

**Interfaces:**

- Consumes: optional `EmbeddingProvider` injection and asynchronous `KnowledgeBase.search()`.
- Produces: vector/fallback metadata in the tool result without changing `ToolDefinition.execute()`.

- [ ] **Step 1: Update the built-in tool test to inject a fake provider**

Add the import and helper to `tests/tools/built-in-tools.test.ts`:

```ts
import type { EmbeddingProvider } from "../../src/main/rag/embedding-provider.js";

const fakeEmbeddingProvider: EmbeddingProvider = {
  id: "fake",
  model: "fake-model",
  embedDocuments: async (texts) => texts.map((_, index) => [index + 1, 1]),
  embedQuery: async () => [1, 1],
};
```

Replace the search test with:

```ts
it("search_knowledge returns vector snippets and diagnostics", async () => {
  const tool = createDefaultToolRegistry({
    embeddingProvider: fakeEmbeddingProvider,
  }).getById("search_knowledge");

  const output = await tool?.execute({ query: "ToolRegistry", topK: 2 });

  expect(output).toContain("retrieval_mode: vector");
  expect(output).toContain("embedding_model: fake-model");
  expect(output).toContain("content:");
});
```

- [ ] **Step 2: Run the tool tests and verify failure**

Run:

```cmd
npx vitest run tests/tools/built-in-tools.test.ts
```

Expected: FAIL because `createDefaultToolRegistry()` does not accept options and does not await the new response shape.

- [ ] **Step 3: Add dependency injection and format retrieval metadata**

Add this import and option near the top of `src/main/tools/built-in-tools.ts`:

```ts
import type { EmbeddingProvider } from "../rag/embedding-provider.js";

export interface CreateDefaultToolRegistryOptions {
  embeddingProvider?: EmbeddingProvider;
}
```

Change the factory start to:

```ts
export function createDefaultToolRegistry(
  options: CreateDefaultToolRegistryOptions = {},
): ToolRegistry {
  const knowledgeBase = createDefaultKnowledgeBase(options.embeddingProvider);
  const registry = new ToolRegistry();
```

Replace the `search_knowledge.execute` body after parsing `query` and `topK` with:

```ts
const response = await knowledgeBase.search(query, topK);
const header = [
  `retrieval_mode: ${response.mode}`,
  response.model ? `embedding_model: ${response.model}` : undefined,
  response.warning ? `warning: ${response.warning}` : undefined,
].filter((line): line is string => Boolean(line));

if (response.results.length === 0) {
  return [...header, "No matching knowledge found."].join("\n");
}

const snippets = response.results.map((result, index) =>
  [
    `[${index + 1}] ${result.chunk.title}`,
    `source: ${result.chunk.source}`,
    `score: ${result.score}`,
    result.matchedTerms
      ? `matched_terms: ${result.matchedTerms.join(", ")}`
      : undefined,
    "content:",
    result.chunk.text,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n"),
);

return [...header, "", ...snippets].join("\n");
```

- [ ] **Step 4: Verify runtime registry construction remains unchanged**

Inspect `src/cli/chat.ts` and confirm the existing function remains:

```ts
export function createRuntimeToolRegistry(): ToolRegistry {
  return createDefaultToolRegistry();
}
```

Do not modify `src/cli/chat.ts`, the Agent Loop, IPC, preload, or renderer in this task.

- [ ] **Step 5: Run all affected tests and commit**

Run:

```cmd
npx vitest run tests/tools/built-in-tools.test.ts tests/agent/tool-agent.test.ts tests/cli/chat.test.ts
npm run typecheck
git add src/main/tools/built-in-tools.ts tests/tools/built-in-tools.test.ts
git commit -m "feat: expose vector retrieval diagnostics"
```

Expected: all affected tests pass, the Agent still exposes exactly four tools, and no live Ollama request occurs during tests.

---

### Task 8: Add the Real Ollama Smoke Test

**Files:**

- Create: `src/cli/test-embedding.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `.env`, `EmbeddingConfig`, and the local Ollama server.
- Produces: `npm run test:embedding` with a clear semantic comparison result.

- [ ] **Step 1: Add the package script**

Add this entry to `package.json` scripts:

```json
"test:embedding": "tsx src/cli/test-embedding.ts"
```

- [ ] **Step 2: Implement the real smoke-test CLI**

Create `src/cli/test-embedding.ts`:

```ts
import { loadEmbeddingConfig } from "../main/config/embedding-config.js";
import { loadLocalEnvFile } from "../main/config/env-file.js";
import { createOllamaEmbeddingProvider } from "../main/rag/ollama-embedding-provider.js";
import { cosineSimilarity } from "../main/rag/vector-math.js";

async function run(): Promise<void> {
  loadLocalEnvFile();
  const config = loadEmbeddingConfig();
  const provider = createOllamaEmbeddingProvider(config);
  const texts = [
    "Agent 可以通过 ToolRegistry 注册工具",
    "工具需要先加入注册表才能被模型调用",
    "今天天气很好",
  ];
  const queryVector = await provider.embedQuery(texts[0]);
  const documentVectors = await provider.embedDocuments([texts[1], texts[2]]);
  const relatedScore = cosineSimilarity(queryVector, documentVectors[0]);
  const unrelatedScore = cosineSimilarity(queryVector, documentVectors[1]);

  console.log(`provider: ${provider.id}`);
  console.log(`model: ${provider.model}`);
  console.log(`dimensions: ${queryVector.length}`);
  console.log(`related_similarity: ${relatedScore.toFixed(6)}`);
  console.log(`unrelated_similarity: ${unrelatedScore.toFixed(6)}`);

  if (relatedScore <= unrelatedScore) {
    throw new Error(
      "Semantic comparison failed: related text was not ranked above unrelated text",
    );
  }
  console.log("semantic comparison: PASS");
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[embedding-test] ${message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Verify static behavior before calling Ollama**

Run:

```cmd
npm run typecheck
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 4: Run the real local integration test**

Run:

```cmd
ollama list
npm run test:embedding
```

Expected output includes:

```text
provider: ollama
model: qwen3-embedding:4b
dimensions: 2560
semantic comparison: PASS
```

If Ollama is unavailable, do not alter application code to hide the failure. Report the exact local prerequisite failure and continue with automated tests.

- [ ] **Step 5: Commit**

Run:

```cmd
git add package.json src/cli/test-embedding.ts
git commit -m "test: add Ollama embedding smoke test"
```

---

### Task 9: Write the Chinese Learning Guide and Perform Final Verification

**Files:**

- Create: `docs/learning/phase-06b-ollama-vector-rag.zh-CN.md`
- Verify: all Phase 6B source and test files.

**Interfaces:**

- Consumes: the completed Phase 6B implementation.
- Produces: a beginner-oriented Chinese explanation and final verification evidence.

- [ ] **Step 1: Write the Chinese learning guide**

Create `docs/learning/phase-06b-ollama-vector-rag.zh-CN.md` with these exact sections and concrete code references:

```markdown
# Phase 6B：Ollama 向量 RAG 学习文档

## 1. 这一阶段解决了什么问题
解释关键词匹配无法理解同义表达，而向量检索比较语义距离。

## 2. 文档索引和用户查询是两条不同流程
逐步展示文档只向量化一次、每个问题都需要生成问题向量。

## 3. EmbeddingProvider 为什么存在
结合 `embedding-provider.ts` 解释接口与 Ollama 实现的区别，并使用 Python Protocol 类比。

## 4. OllamaEmbeddingProvider 如何调用模型
结合 `ollama-embedding-provider.ts` 解释 `/api/embed`、批量输入、查询指令、超时和响应验证。

## 5. 向量和余弦相似度
结合 `vector-math.ts` 用二维向量手算点积、长度和最终余弦分数。

## 6. InMemoryVectorIndex 保存了什么
结合 `in-memory-vector-index.ts` 说明 `Map<chunkId, vector>`、维度约束和程序退出后数据消失。

## 7. VectorRetriever 如何完成检索
结合 `vector-retriever.ts` 解释缺失向量检测、批量索引、问题向量、排序和 Top K。

## 8. KnowledgeBase 如何组织两种检索
结合 `knowledge-base.ts` 解释向量成功和关键词回退两条分支。

## 9. RAG 如何通过 Tool 进入 Agent Loop
结合 `built-in-tools.ts` 追踪 `search_knowledge -> KnowledgeBase.search -> Tool result -> model`。

## 10. 如何测试
列出 `npm test`、`npm run test:embedding` 和 `npm run dev:electron`，并解释每个命令证明什么。

## 11. 当前版本仍缺少什么
说明内存向量会在重启后丢失，Phase 6C 将实现持久化和索引元数据。
```

Expand every section with actual implementation snippets and Python analogies; do not copy the design document verbatim.

- [ ] **Step 2: Run the complete automated suite**

Run:

```cmd
npm test
```

Expected: every test passes and no request reaches `localhost:11434`.

- [ ] **Step 3: Run static and production-build verification**

Run:

```cmd
npm run typecheck
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 4: Run real embedding verification once more**

Run:

```cmd
npm run test:embedding
```

Expected: `semantic comparison: PASS` and the reported model is `qwen3-embedding:4b`.

- [ ] **Step 5: Manually verify the Electron tool path**

Run:

```cmd
npm run dev:electron
```

Send:

```text
请搜索知识库，Agent 是怎样注册和执行工具的？
```

Expected tool output includes:

```text
retrieval_mode: vector
embedding_model: qwen3-embedding:4b
```

Stop Ollama and send the same query again. Expected output includes `retrieval_mode: keyword-fallback` and a clear connection error while the Electron application remains open.

- [ ] **Step 6: Commit documentation and any final test-only corrections**

Run:

```cmd
git add docs/learning/phase-06b-ollama-vector-rag.zh-CN.md
git commit -m "docs: explain Ollama vector RAG"
```

- [ ] **Step 7: Inspect final scope**

Run:

```cmd
git status --short
git log --oneline -10
```

Expected: no uncommitted Phase 6B files remain, and commits correspond to the task boundaries above.

---

## Final Acceptance Checklist

- [ ] `EmbeddingProvider` is independent from Ollama transport details.
- [ ] `qwen3-embedding:4b` is the default but not hard-coded outside configuration defaults.
- [ ] Document embedding uses batch input.
- [ ] Query embedding adds the retrieval instruction.
- [ ] Full cosine similarity validates empty, non-finite, zero, and mismatched vectors.
- [ ] Existing chunk vectors are reused within the process.
- [ ] Newly added chunks are embedded incrementally.
- [ ] `KnowledgeBase.search()` reports `vector` or `keyword-fallback`.
- [ ] Tool output reports the embedding model or fallback warning.
- [ ] Automated tests do not depend on Ollama.
- [ ] The real smoke test reports 2560 dimensions and a passing semantic comparison.
- [ ] Agent Loop, Vendor Adapter, IPC, preload, and renderer behavior remain unchanged.
- [ ] The Chinese learning guide explains the completed code rather than only the concepts.
