import { loadEmbeddingConfig } from "../config/embedding-config.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { createInMemoryVectorIndex } from "./in-memory-vector-index.js";
import { createKnowledgeBase, type KnowledgeBase } from "./knowledge-base.js";
import { createOllamaEmbeddingProvider } from "./ollama-embedding-provider.js";
import type { KnowledgeDocument } from "./rag-types.js";
import { createVectorRetriever } from "./vector-retriever.js";

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
