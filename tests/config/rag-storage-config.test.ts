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
