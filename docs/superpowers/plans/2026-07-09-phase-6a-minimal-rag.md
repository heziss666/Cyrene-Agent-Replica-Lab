# Phase 6A Minimal RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, testable RAG foundation with chunking, an in-memory knowledge base, keyword retrieval, and a `search_knowledge` tool.

**Architecture:** RAG core code lives under `src/main/rag` and has no Electron or LLM dependency. The built-in tool registry creates one default knowledge base and exposes it through a tool, allowing the existing tool-calling loop to use retrieval without changing the agent loop.

**Tech Stack:** TypeScript, Node.js 22 LTS, Vitest, existing ToolRegistry, existing OpenAI-compatible function-calling loop.

## Global Constraints

- Keep Phase 6A embedding-free: no Ollama, no vector store, no cosine similarity.
- Keep RAG core independent from Electron, IPC, renderer, and vendor adapters.
- Use deterministic tests with no network access.
- Keep default knowledge small and local to the main process.
- Preserve existing public tool behavior for `get_current_time`, `calculator`, and `echo`.

---

## File Structure

- Create `src/main/rag/rag-types.ts`: shared RAG interfaces.
- Create `src/main/rag/chunk-text.ts`: deterministic character-window text chunking.
- Create `src/main/rag/keyword-retriever.ts`: simple keyword scoring over chunks.
- Create `src/main/rag/knowledge-store.ts`: in-memory document and chunk storage.
- Create `src/main/rag/knowledge-base.ts`: composition layer that owns store and retriever.
- Create `src/main/rag/default-knowledge.ts`: seed documents and factory for the default knowledge base.
- Modify `src/main/tools/built-in-tools.ts`: register `search_knowledge`.
- Create `tests/rag/chunk-text.test.ts`.
- Create `tests/rag/keyword-retriever.test.ts`.
- Create `tests/rag/knowledge-base.test.ts`.
- Modify `tests/tools/built-in-tools.test.ts`.
- Create `docs/learning/phase-06a-minimal-rag.zh-CN.md`: Chinese learning guide.

---

### Task 1: RAG Types and Chunking

**Files:**
- Create: `src/main/rag/rag-types.ts`
- Create: `src/main/rag/chunk-text.ts`
- Test: `tests/rag/chunk-text.test.ts`

**Interfaces:**
- Produces: `KnowledgeDocument`, `KnowledgeChunk`, `KnowledgeSearchResult`
- Produces: `chunkDocument(document, options?): KnowledgeChunk[]`

- [ ] **Step 1: Write the failing chunking tests**

Create `tests/rag/chunk-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chunkDocument } from "../../src/main/rag/chunk-text.js";
import type { KnowledgeDocument } from "../../src/main/rag/rag-types.js";

function makeDocument(text: string): KnowledgeDocument {
  return {
    id: "doc_1",
    title: "Test Document",
    text,
    source: "test",
  };
}

describe("chunkDocument", () => {
  it("returns one chunk when the text fits in the chunk size", () => {
    const chunks = chunkDocument(makeDocument("short text"), {
      chunkSizeChars: 100,
      overlapChars: 20,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      id: "doc_1_chunk_0",
      documentId: "doc_1",
      title: "Test Document",
      text: "short text",
      source: "test",
      index: 0,
    });
  });

  it("creates overlapping chunks for long text", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const chunks = chunkDocument(makeDocument(text), {
      chunkSizeChars: 10,
      overlapChars: 3,
    });

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "abcdefghij",
      "hijklmnopq",
      "opqrstuvwx",
      "vwxyz",
    ]);
  });

  it("rejects an overlap that is not smaller than the chunk size", () => {
    expect(() =>
      chunkDocument(makeDocument("abc"), {
        chunkSizeChars: 10,
        overlapChars: 10,
      }),
    ).toThrow("overlapChars must be smaller than chunkSizeChars");
  });

  it("ignores blank text", () => {
    const chunks = chunkDocument(makeDocument("   \n\t  "));
    expect(chunks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/rag/chunk-text.test.ts
```

Expected: fail because `src/main/rag/chunk-text.ts` does not exist.

- [ ] **Step 3: Implement RAG types**

Create `src/main/rag/rag-types.ts`:

```ts
export interface KnowledgeDocument {
  id: string;
  title: string;
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  title: string;
  text: string;
  source: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms: string[];
}
```

- [ ] **Step 4: Implement character-window chunking**

Create `src/main/rag/chunk-text.ts`:

```ts
import type { KnowledgeChunk, KnowledgeDocument } from "./rag-types.js";

export interface ChunkDocumentOptions {
  chunkSizeChars?: number;
  overlapChars?: number;
}

const DEFAULT_CHUNK_SIZE_CHARS = 600;
const DEFAULT_OVERLAP_CHARS = 120;

export function chunkDocument(
  document: KnowledgeDocument,
  options: ChunkDocumentOptions = {},
): KnowledgeChunk[] {
  const chunkSizeChars = options.chunkSizeChars ?? DEFAULT_CHUNK_SIZE_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  if (chunkSizeChars <= 0) {
    throw new Error("chunkSizeChars must be greater than 0");
  }

  if (overlapChars < 0) {
    throw new Error("overlapChars must be greater than or equal to 0");
  }

  if (overlapChars >= chunkSizeChars) {
    throw new Error("overlapChars must be smaller than chunkSizeChars");
  }

  const text = document.text.trim();
  if (!text) {
    return [];
  }

  const chunks: KnowledgeChunk[] = [];
  const step = chunkSizeChars - overlapChars;

  for (let start = 0, index = 0; start < text.length; start += step, index += 1) {
    const end = Math.min(start + chunkSizeChars, text.length);
    const chunkText = text.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        id: `${document.id}_chunk_${index}`,
        documentId: document.id,
        title: document.title,
        text: chunkText,
        source: document.source,
        index,
        metadata: document.metadata,
      });
    }

    if (end >= text.length) {
      break;
    }
  }

  return chunks;
}
```

- [ ] **Step 5: Verify Task 1**

Run:

```bash
npm test -- tests/rag/chunk-text.test.ts
npm run typecheck
```

Expected: both pass.

---

### Task 2: Keyword Retriever

**Files:**
- Create: `src/main/rag/keyword-retriever.ts`
- Test: `tests/rag/keyword-retriever.test.ts`

**Interfaces:**
- Consumes: `KnowledgeChunk`, `KnowledgeSearchResult`
- Produces: `extractSearchTerms(query): string[]`
- Produces: `searchChunksByKeyword(query, chunks, options?): KnowledgeSearchResult[]`

- [ ] **Step 1: Write the failing keyword retriever tests**

Create `tests/rag/keyword-retriever.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  extractSearchTerms,
  searchChunksByKeyword,
} from "../../src/main/rag/keyword-retriever.js";
import type { KnowledgeChunk } from "../../src/main/rag/rag-types.js";

function chunk(id: string, title: string, text: string): KnowledgeChunk {
  return {
    id,
    documentId: "doc",
    title,
    text,
    source: "test",
    index: 0,
  };
}

describe("extractSearchTerms", () => {
  it("extracts lowercase English terms, numbers, and Chinese terms", () => {
    expect(extractSearchTerms("RAG Phase 6A 知识库 检索")).toEqual([
      "rag",
      "phase",
      "6a",
      "知识库",
      "检索",
    ]);
  });

  it("returns an empty array for blank query", () => {
    expect(extractSearchTerms("   ")).toEqual([]);
  });
});

describe("searchChunksByKeyword", () => {
  it("ranks chunks with more matches first", () => {
    const results = searchChunksByKeyword("agent 工具", [
      chunk("a", "Agent Tools", "Agent can call tools. Tools return observations."),
      chunk("b", "Session", "Session stores chat messages."),
      chunk("c", "工具系统", "工具 schema 会发送给模型。"),
    ]);

    expect(results.map((result) => result.chunk.id)).toEqual(["a", "c"]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("adds score when the title matches", () => {
    const results = searchChunksByKeyword("rag", [
      chunk("a", "RAG", "unrelated body"),
      chunk("b", "Other", "rag appears in body"),
    ]);

    expect(results[0].chunk.id).toBe("a");
  });

  it("respects topK", () => {
    const results = searchChunksByKeyword(
      "agent",
      [
        chunk("a", "A", "agent"),
        chunk("b", "B", "agent"),
        chunk("c", "C", "agent"),
      ],
      { topK: 2 },
    );

    expect(results).toHaveLength(2);
  });

  it("returns no results for empty query", () => {
    const results = searchChunksByKeyword(" ", [chunk("a", "A", "agent")]);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/rag/keyword-retriever.test.ts
```

Expected: fail because `keyword-retriever.ts` does not exist.

- [ ] **Step 3: Implement the keyword retriever**

Create `src/main/rag/keyword-retriever.ts`:

```ts
import type { KnowledgeChunk, KnowledgeSearchResult } from "./rag-types.js";

export interface KeywordSearchOptions {
  topK?: number;
}

const DEFAULT_TOP_K = 5;

export function extractSearchTerms(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  return Array.from(normalized.matchAll(/[a-z0-9]+|[\u4e00-\u9fff]+/g))
    .map((match) => match[0])
    .filter((term, index, terms) => term.length > 0 && terms.indexOf(term) === index);
}

function countOccurrences(text: string, term: string): number {
  if (!text || !term) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (position < text.length) {
    const next = text.indexOf(term, position);
    if (next === -1) {
      break;
    }
    count += 1;
    position = next + term.length;
  }

  return count;
}

export function searchChunksByKeyword(
  query: string,
  chunks: KnowledgeChunk[],
  options: KeywordSearchOptions = {},
): KnowledgeSearchResult[] {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const scored = chunks
    .map((chunk) => {
      const title = chunk.title.toLowerCase();
      const text = chunk.text.toLowerCase();
      const matchedTerms: string[] = [];
      let score = 0;

      for (const term of terms) {
        const titleMatches = countOccurrences(title, term);
        const bodyMatches = countOccurrences(text, term);
        const termScore = titleMatches * 3 + bodyMatches;

        if (termScore > 0) {
          matchedTerms.push(term);
          score += termScore;
        }
      }

      return { chunk, score, matchedTerms };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.chunk.id.localeCompare(b.chunk.id);
    });

  return scored.slice(0, topK);
}
```

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm test -- tests/rag/keyword-retriever.test.ts
npm run typecheck
```

Expected: both pass.

---

### Task 3: Knowledge Store and Knowledge Base

**Files:**
- Create: `src/main/rag/knowledge-store.ts`
- Create: `src/main/rag/knowledge-base.ts`
- Test: `tests/rag/knowledge-base.test.ts`

**Interfaces:**
- Consumes: `chunkDocument`, `searchChunksByKeyword`
- Produces: `createInMemoryKnowledgeStore()`
- Produces: `createKnowledgeBase(initialDocuments?)`

- [ ] **Step 1: Write the failing knowledge base tests**

Create `tests/rag/knowledge-base.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createKnowledgeBase } from "../../src/main/rag/knowledge-base.js";

describe("createKnowledgeBase", () => {
  it("adds documents and searches their chunks", () => {
    const knowledgeBase = createKnowledgeBase();

    const chunks = knowledgeBase.addDocument({
      title: "Agent Tools",
      text: "The agent can call tools through the ToolRegistry.",
      source: "test",
    });

    expect(chunks).toHaveLength(1);

    const results = knowledgeBase.search("ToolRegistry", 3);

    expect(results).toHaveLength(1);
    expect(results[0].chunk.title).toBe("Agent Tools");
  });

  it("loads initial documents", () => {
    const knowledgeBase = createKnowledgeBase([
      {
        id: "initial_doc",
        title: "Initial Knowledge",
        text: "RAG means retrieval augmented generation.",
        source: "seed",
      },
    ]);

    expect(knowledgeBase.search("retrieval")).toHaveLength(1);
  });

  it("clears all documents and chunks", () => {
    const knowledgeBase = createKnowledgeBase();

    knowledgeBase.addDocument({
      title: "Temporary",
      text: "This should disappear.",
      source: "test",
    });

    knowledgeBase.clear();

    expect(knowledgeBase.search("disappear")).toEqual([]);
  });

  it("creates stable generated document ids", () => {
    const knowledgeBase = createKnowledgeBase();

    const first = knowledgeBase.addDocument({
      title: "First",
      text: "alpha",
      source: "test",
    });
    const second = knowledgeBase.addDocument({
      title: "Second",
      text: "beta",
      source: "test",
    });

    expect(first[0].documentId).toBe("doc_1");
    expect(second[0].documentId).toBe("doc_2");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/rag/knowledge-base.test.ts
```

Expected: fail because `knowledge-base.ts` does not exist.

- [ ] **Step 3: Implement the in-memory store**

Create `src/main/rag/knowledge-store.ts`:

```ts
import { chunkDocument } from "./chunk-text.js";
import type { KnowledgeChunk, KnowledgeDocument } from "./rag-types.js";

export interface KnowledgeStore {
  addDocument(document: KnowledgeDocument): KnowledgeChunk[];
  getChunks(): KnowledgeChunk[];
  clear(): void;
}

function cloneChunk(chunk: KnowledgeChunk): KnowledgeChunk {
  return {
    ...chunk,
    metadata: chunk.metadata ? { ...chunk.metadata } : undefined,
  };
}

export function createInMemoryKnowledgeStore(): KnowledgeStore {
  let chunks: KnowledgeChunk[] = [];

  return {
    addDocument(document) {
      const nextChunks = chunkDocument(document);
      chunks = chunks.concat(nextChunks);
      return nextChunks.map(cloneChunk);
    },

    getChunks() {
      return chunks.map(cloneChunk);
    },

    clear() {
      chunks = [];
    },
  };
}
```

- [ ] **Step 4: Implement the knowledge base**

Create `src/main/rag/knowledge-base.ts`:

```ts
import { createInMemoryKnowledgeStore, type KnowledgeStore } from "./knowledge-store.js";
import { searchChunksByKeyword } from "./keyword-retriever.js";
import type { KnowledgeChunk, KnowledgeDocument, KnowledgeSearchResult } from "./rag-types.js";

export interface AddKnowledgeDocumentInput {
  id?: string;
  title: string;
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeBase {
  addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[];
  search(query: string, topK?: number): KnowledgeSearchResult[];
  clear(): void;
}

export function createKnowledgeBase(
  initialDocuments: KnowledgeDocument[] = [],
  store: KnowledgeStore = createInMemoryKnowledgeStore(),
): KnowledgeBase {
  let nextDocumentNumber = 1;

  function addDocument(input: AddKnowledgeDocumentInput): KnowledgeChunk[] {
    const id = input.id ?? `doc_${nextDocumentNumber}`;
    if (!input.id) {
      nextDocumentNumber += 1;
    }

    return store.addDocument({
      id,
      title: input.title,
      text: input.text,
      source: input.source ?? "local",
      metadata: input.metadata,
    });
  }

  for (const document of initialDocuments) {
    addDocument(document);
  }

  return {
    addDocument,

    search(query, topK = 5) {
      return searchChunksByKeyword(query, store.getChunks(), { topK });
    },

    clear() {
      store.clear();
    },
  };
}
```

- [ ] **Step 5: Verify Task 3**

Run:

```bash
npm test -- tests/rag/knowledge-base.test.ts
npm run typecheck
```

Expected: both pass.

---

### Task 4: Default Knowledge and Built-In Tool

**Files:**
- Create: `src/main/rag/default-knowledge.ts`
- Modify: `src/main/tools/built-in-tools.ts`
- Modify: `tests/tools/built-in-tools.test.ts`

**Interfaces:**
- Consumes: `createKnowledgeBase`
- Produces: `createDefaultKnowledgeBase()`
- Produces built-in tool: `search_knowledge`

- [ ] **Step 1: Inspect the existing built-in tool tests**

Run:

```bash
npm test -- tests/tools/built-in-tools.test.ts
```

Expected: pass before changes.

- [ ] **Step 2: Extend built-in tool tests**

Modify `tests/tools/built-in-tools.test.ts` to include these assertions:

```ts
it("registers the search_knowledge tool", () => {
  const registry = createDefaultToolRegistry();

  const specs = registry.getToolSpecs();

  expect(specs.some((spec) => spec.name === "search_knowledge")).toBe(true);
});

it("search_knowledge returns matching knowledge snippets", async () => {
  const registry = createDefaultToolRegistry();

  const result = await registry.executeTool({
    id: "call_1",
    name: "search_knowledge",
    arguments: JSON.stringify({
      query: "ToolRegistry",
      topK: 2,
    }),
  });

  expect(result.output).toContain("ToolRegistry");
  expect(result.output).toContain("content:");
});
```

- [ ] **Step 3: Run the failing test**

Run:

```bash
npm test -- tests/tools/built-in-tools.test.ts
```

Expected: fail because `search_knowledge` is not registered yet.

- [ ] **Step 4: Create default knowledge**

Create `src/main/rag/default-knowledge.ts`:

```ts
import { createKnowledgeBase, type KnowledgeBase } from "./knowledge-base.js";
import type { KnowledgeDocument } from "./rag-types.js";

const DEFAULT_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: "seed_project_overview",
    title: "Cyrene Agent Replica Lab Overview",
    source: "seed",
    text:
      "Cyrene Agent Replica Lab is a TypeScript and Electron learning project for understanding agent development. " +
      "It has implemented OpenAI-compatible model calls, a ToolRegistry, function calling, AgentEvent tracing, " +
      "an Electron main/preload/renderer shell, and a multi-turn chat session.",
  },
  {
    id: "seed_tool_registry",
    title: "ToolRegistry",
    source: "seed",
    text:
      "ToolRegistry stores enabled tools, exposes their JSON schemas to the model, and executes tool calls requested by the model. " +
      "Built-in tools currently include time, calculator, echo, and search_knowledge.",
  },
  {
    id: "seed_minimal_rag",
    title: "Minimal RAG",
    source: "seed",
    text:
      "Minimal RAG stores local knowledge as text chunks. The search_knowledge tool retrieves relevant chunks and returns them to the model. " +
      "Phase 6A uses keyword search before adding embeddings and vector search in a later phase.",
  },
];

export function createDefaultKnowledgeBase(): KnowledgeBase {
  return createKnowledgeBase(DEFAULT_DOCUMENTS);
}
```

- [ ] **Step 5: Register `search_knowledge`**

Modify `src/main/tools/built-in-tools.ts`:

```ts
import { createDefaultKnowledgeBase } from "../rag/default-knowledge.js";
```

Inside `createDefaultToolRegistry()`, create the knowledge base:

```ts
const knowledgeBase = createDefaultKnowledgeBase();
```

Add this tool before returning the registry:

```ts
const searchKnowledgeTool: ToolDefinition = {
  id: "search_knowledge",
  description: "Search the local knowledge base for relevant text snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query describing what knowledge to retrieve.",
      },
      topK: {
        type: "number",
        description: "Maximum number of snippets to return.",
      },
    },
    required: ["query"],
  },
  enabled: true,
  execute: async (args) => {
    const query = stringifyArg(args.query).trim();
    const topK = typeof args.topK === "number" ? args.topK : 5;
    const results = knowledgeBase.search(query, topK);

    if (results.length === 0) {
      return "No matching knowledge found.";
    }

    return results
      .map((result, index) => {
        return [
          `[${index + 1}] ${result.chunk.title}`,
          `source: ${result.chunk.source}`,
          `score: ${result.score}`,
          `matched_terms: ${result.matchedTerms.join(", ")}`,
          "content:",
          result.chunk.text,
        ].join("\n");
      })
      .join("\n\n");
  },
};
```

Register it:

```ts
registry.register(searchKnowledgeTool);
```

- [ ] **Step 6: Verify Task 4**

Run:

```bash
npm test -- tests/tools/built-in-tools.test.ts
npm run typecheck
```

Expected: both pass.

---

### Task 5: Learning Documentation and Full Verification

**Files:**
- Create: `docs/learning/phase-06a-minimal-rag.zh-CN.md`

**Interfaces:**
- Documents the code added in Tasks 1-4.

- [ ] **Step 1: Write the Chinese learning guide**

Create `docs/learning/phase-06a-minimal-rag.zh-CN.md` with these sections:

```markdown
# Phase 6A：最小 RAG 基础版

## 这一阶段解决什么问题

## RAG 的最小数据流

## document / chunk / search result 分别是什么

## chunk-text.ts 如何切块

## keyword-retriever.ts 如何打分

## knowledge-store.ts 和 knowledge-base.ts 的区别

## search_knowledge 工具如何进入 Agent Loop

## 和源项目 RAG 的区别

## 下一步为什么要接 embedding
```

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: all test files pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript reports no errors.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: Electron and renderer builds complete.

- [ ] **Step 5: Manual Electron check**

Run:

```bash
npm run dev:electron
```

Ask:

```text
请查一下知识库，这个学习版 Agent 目前实现了什么？
```

Expected:

```text
Agent Events shows a search_knowledge tool call.
The final answer mentions the TypeScript/Electron learning project and implemented modules.
```

---

## Self-Review

- Spec coverage: the plan covers RAG types, chunking, in-memory store, keyword retriever, knowledge base, default seed knowledge, built-in tool registration, tests, and Chinese learning documentation.
- Placeholder scan: no placeholder tasks are used; each task includes concrete files, code, commands, and expected outcomes.
- Type consistency: `KnowledgeDocument`, `KnowledgeChunk`, `KnowledgeSearchResult`, `createKnowledgeBase`, `createDefaultKnowledgeBase`, and `searchChunksByKeyword` names are consistent across tasks.
