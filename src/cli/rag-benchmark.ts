import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnvFile } from "../main/config/env-file.js";
import { chunkDocument } from "../main/rag/chunk-text.js";
import {
  defaultCyreneKnowledgeDir,
  loadCyreneKnowledgeDocuments,
} from "../main/rag/cyrene-knowledge.js";
import { createDefaultKnowledgeBase } from "../main/rag/default-knowledge.js";
import type { KnowledgeBase } from "../main/rag/knowledge-base.js";
import type {
  KnowledgeDocument,
  KnowledgeSearchResponse,
} from "../main/rag/rag-types.js";
import type { VectorIndexFile } from "../main/rag/vector-index-types.js";

export interface RagEvaluationCase {
  question: string;
  expectedDocumentIds: string[];
}

export const DEFAULT_RAG_EVALUATION_CASES: RagEvaluationCase[] = [
  {
    question: "昔涟最初是什么形态？",
    expectedDocumentIds: ["worldbook_cyrene_翁法罗斯之心-philia093"],
  },
  {
    question: "迷迷、昔涟和德谬歌是什么关系？",
    expectedDocumentIds: ["worldbook_cyrene_三形态同一性"],
  },
  {
    question: "白厄是谁？",
    expectedDocumentIds: ["worldbook_characters_白厄-phainon"],
  },
  {
    question: "翁法罗斯经历了什么？",
    expectedDocumentIds: ["worldbook_world_翁法罗斯"],
  },
  {
    question: "《如我所书》是什么？",
    expectedDocumentIds: ["worldbook_cyrene_如我所书"],
  },
  {
    question: "昔涟为什么会被开拓者吸引？",
    expectedDocumentIds: ["worldbook_cyrene_昔涟与开拓者"],
  },
];

export interface RagBenchmarkReport {
  markdownFileCount: number;
  documentCount: number;
  chunkCount: number;
  vectorDimensions: number;
  indexBytes: number;
  coldBuildMs: number;
  warmLoadMs: number;
  averageQueryMs: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
}

export interface RecallEvaluationResult {
  expectedDocumentIds: string[];
  returnedDocumentIds: string[];
}

interface BenchmarkSearchSession {
  search(query: string, topK?: number): Promise<KnowledgeSearchResponse>;
}

export interface RagBenchmarkDependencies {
  createTemporaryDirectory(): Promise<string>;
  removeTemporaryDirectory(path: string): Promise<void>;
  createKnowledgeBase(vectorIndexPath: string): BenchmarkSearchSession;
  loadDocuments(): KnowledgeDocument[];
  countMarkdownFiles(): number;
  readIndexStats(path: string): Promise<{
    vectorDimensions: number;
    indexBytes: number;
  }>;
  now(): number;
}

export function calculateRecallAtK(
  results: RecallEvaluationResult[],
  k: number,
): number {
  if (results.length === 0 || k <= 0) return 0;
  const hits = results.filter((result) => {
    const returned = new Set(result.returnedDocumentIds.slice(0, k));
    return result.expectedDocumentIds.some((id) => returned.has(id));
  }).length;
  return hits / results.length;
}

function countDefaultMarkdownFiles(): number {
  const knowledgeDir = defaultCyreneKnowledgeDir();
  const worldbook = readdirSync(join(knowledgeDir, "worldbook"));
  return worldbook.filter((file) => file.toLowerCase().endsWith(".md")).length + 1;
}

async function readDefaultIndexStats(path: string): Promise<{
  vectorDimensions: number;
  indexBytes: number;
}> {
  const [content, fileStats] = await Promise.all([
    readFile(path, "utf8"),
    stat(path),
  ]);
  const parsed = JSON.parse(content) as VectorIndexFile;
  return {
    vectorDimensions: parsed.embedding.dimensions,
    indexBytes: fileStats.size,
  };
}

function createBenchmarkKnowledgeBase(vectorIndexPath: string): KnowledgeBase {
  const dataDir = dirname(vectorIndexPath);
  return createDefaultKnowledgeBase({
    storageConfig: { dataDir, vectorIndexPath },
    logger: (message) => console.log(message),
  });
}

function createDefaultDependencies(): RagBenchmarkDependencies {
  return {
    createTemporaryDirectory: () => mkdtemp(join(tmpdir(), "cyrene-rag-benchmark-")),
    removeTemporaryDirectory: (path) => rm(path, { recursive: true, force: true }),
    createKnowledgeBase: createBenchmarkKnowledgeBase,
    loadDocuments: loadCyreneKnowledgeDocuments,
    countMarkdownFiles: countDefaultMarkdownFiles,
    readIndexStats: readDefaultIndexStats,
    now: () => performance.now(),
  };
}

function requireVectorResponse(
  response: KnowledgeSearchResponse,
  phase: string,
): KnowledgeSearchResponse {
  if (response.mode !== "vector") {
    throw new Error(
      `RAG benchmark requires vector retrieval during ${phase}; received ${response.mode}`,
    );
  }
  return response;
}

export async function runRagBenchmark(options: {
  evaluationCases?: RagEvaluationCase[];
  dependencies?: RagBenchmarkDependencies;
} = {}): Promise<RagBenchmarkReport> {
  const evaluationCases = options.evaluationCases ?? DEFAULT_RAG_EVALUATION_CASES;
  const dependencies = options.dependencies ?? createDefaultDependencies();
  const markdownFileCount = dependencies.countMarkdownFiles();
  const documents = dependencies.loadDocuments();
  const chunkCount = documents.flatMap((document) => chunkDocument(document)).length;
  const temporaryDirectory = await dependencies.createTemporaryDirectory();
  const vectorIndexPath = join(temporaryDirectory, "vector-index.json");

  try {
    const warmupQuestion = evaluationCases[0]?.question ?? "昔涟是谁？";

    const coldKnowledgeBase = dependencies.createKnowledgeBase(vectorIndexPath);
    const coldStarted = dependencies.now();
    requireVectorResponse(
      await coldKnowledgeBase.search(warmupQuestion, 5),
      "cold build",
    );
    const coldBuildMs = dependencies.now() - coldStarted;

    const warmKnowledgeBase = dependencies.createKnowledgeBase(vectorIndexPath);
    const warmStarted = dependencies.now();
    requireVectorResponse(
      await warmKnowledgeBase.search(warmupQuestion, 5),
      "warm load",
    );
    const warmLoadMs = dependencies.now() - warmStarted;

    const recallResults: RecallEvaluationResult[] = [];
    const queryTimes: number[] = [];
    for (const evaluationCase of evaluationCases) {
      const queryStarted = dependencies.now();
      const response = requireVectorResponse(
        await warmKnowledgeBase.search(evaluationCase.question, 5),
        `evaluation query: ${evaluationCase.question}`,
      );
      queryTimes.push(dependencies.now() - queryStarted);
      recallResults.push({
        expectedDocumentIds: evaluationCase.expectedDocumentIds,
        returnedDocumentIds: response.results.map((result) => result.chunk.documentId),
      });
    }

    const indexStats = await dependencies.readIndexStats(vectorIndexPath);
    const averageQueryMs = queryTimes.length === 0
      ? 0
      : queryTimes.reduce((total, value) => total + value, 0) / queryTimes.length;

    return {
      markdownFileCount,
      documentCount: documents.length,
      chunkCount,
      ...indexStats,
      coldBuildMs,
      warmLoadMs,
      averageQueryMs,
      recallAt1: calculateRecallAtK(recallResults, 1),
      recallAt3: calculateRecallAtK(recallResults, 3),
      recallAt5: calculateRecallAtK(recallResults, 5),
    };
  } finally {
    await dependencies.removeTemporaryDirectory(temporaryDirectory);
  }
}

export function formatRagBenchmarkReport(report: RagBenchmarkReport): string {
  return [
    "Cyrene RAG benchmark",
    `Markdown files: ${report.markdownFileCount}`,
    `Documents: ${report.documentCount}`,
    `Chunks: ${report.chunkCount}`,
    `Vector dimensions: ${report.vectorDimensions}`,
    `Index bytes: ${report.indexBytes}`,
    `Cold build: ${report.coldBuildMs.toFixed(1)} ms`,
    `Warm load: ${report.warmLoadMs.toFixed(1)} ms`,
    `Average query: ${report.averageQueryMs.toFixed(1)} ms`,
    `Recall@1: ${report.recallAt1.toFixed(3)}`,
    `Recall@3: ${report.recallAt3.toFixed(3)}`,
    `Recall@5: ${report.recallAt5.toFixed(3)}`,
  ].join("\n");
}

function isDirectRun(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectRun()) {
  loadLocalEnvFile();
  runRagBenchmark()
    .then((report) => console.log(formatRagBenchmarkReport(report)))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[rag benchmark] ${message}`);
      process.exitCode = 1;
    });
}
