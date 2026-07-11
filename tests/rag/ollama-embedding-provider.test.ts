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
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
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
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
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
      vi.fn(async () =>
        jsonResponse({ error: "model missing" }, 404),
      ) as unknown as typeof fetch,
    );
    await expect(httpFailure.embedQuery("hello")).rejects.toThrow(
      "Ollama embedding request failed: HTTP 404",
    );

    const invalidBatch = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () =>
        jsonResponse({ embeddings: [[1, 0]] }),
      ) as unknown as typeof fetch,
    );
    await expect(invalidBatch.embedDocuments(["one", "two"])).rejects.toThrow(
      "Ollama returned 1 embeddings for 2 inputs",
    );
  });

  it("rejects inconsistent and non-finite vectors", async () => {
    const inconsistent = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () =>
        jsonResponse({ embeddings: [[1, 0], [1, 0, 2]] }),
      ) as unknown as typeof fetch,
    );
    await expect(inconsistent.embedDocuments(["one", "two"])).rejects.toThrow(
      "Ollama returned inconsistent vector dimensions",
    );

    const nonFinite = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () =>
        jsonResponse({ embeddings: [[Number.NaN, 1]] }),
      ) as unknown as typeof fetch,
    );
    await expect(nonFinite.embedQuery("hello")).rejects.toThrow(
      "Ollama embedding 0 contains a non-finite value at index 0",
    );
  });

  it("rejects responses without embeddings", async () => {
    const provider = createOllamaEmbeddingProvider(
      config,
      vi.fn(async () =>
        jsonResponse({ model: "qwen3-embedding:4b" }),
      ) as unknown as typeof fetch,
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
