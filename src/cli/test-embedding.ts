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
