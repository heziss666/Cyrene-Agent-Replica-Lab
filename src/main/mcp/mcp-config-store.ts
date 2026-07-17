import { readFile, rename } from "node:fs/promises";
import { writeFileAtomically } from "../rag/atomic-file-write.js";
import { parseMcpServerConfigsFile } from "./mcp-config-validation.js";
import type { McpServerConfig } from "./mcp-types.js";

export interface McpConfigStore {
  load(): Promise<McpServerConfig[]>;
  save(configs: readonly McpServerConfig[]): Promise<void>;
}

export function createMcpConfigStore(
  filePath: string,
  options: { now?: () => number } = {},
): McpConfigStore {
  const now = options.now ?? Date.now;
  return {
    async load() {
      try {
        return parseMcpServerConfigsFile(JSON.parse(await readFile(filePath, "utf8")) as unknown);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        try {
          await rename(filePath, `${filePath}.corrupt-${now()}`);
        } catch {
          // Defaults remain usable if quarantine is unavailable.
        }
        return [];
      }
    },
    async save(configs) {
      const servers = parseMcpServerConfigsFile({ schemaVersion: 1, servers: configs });
      await writeFileAtomically(filePath, `${JSON.stringify({
        schemaVersion: 1,
        servers,
      }, null, 2)}\n`);
    },
  };
}
