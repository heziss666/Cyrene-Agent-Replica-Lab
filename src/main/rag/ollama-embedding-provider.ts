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
