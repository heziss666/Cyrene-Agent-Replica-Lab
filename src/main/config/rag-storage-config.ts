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
