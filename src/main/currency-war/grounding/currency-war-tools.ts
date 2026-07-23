import type { ToolRegistry } from "../../tools/tool-registry.js";
import type { CurrencyWarFactService } from "./currency-war-facts.js";

const MAX_NAMES = 20;

export function registerCurrencyWarTools(
  registry: ToolRegistry,
  facts: CurrencyWarFactService,
): void {
  registry.register({
    id: "lookup_currency_war_data",
    description: [
      "Look up exact local Currency War facts for characters, bonds, equipment,",
      "investment environments, and investment strategies.",
      "Use this before making any factual claim about a game entity not already present in the evidence pack.",
    ].join(" "),
    enabled: true,
    metadata: { source: "builtin", risk: "read" },
    parameters: {
      type: "object",
      properties: {
        names: {
          type: "array",
          description: "One or more exact Chinese entity names to look up.",
          items: { type: "string" },
        },
        include_related: {
          type: "boolean",
          description: "Also return directly related catalog entities.",
        },
      },
      required: ["names"],
      additionalProperties: false,
    },
    execute: async (args) => {
      if (!Array.isArray(args.names)) return "[error] CURRENCY_WAR_NAMES_REQUIRED";
      const names = [...new Set(args.names
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean))];
      if (names.length === 0) return "[error] CURRENCY_WAR_NAMES_REQUIRED";
      if (names.length > MAX_NAMES) return "[error] CURRENCY_WAR_TOO_MANY_NAMES";

      const result = facts.lookup(names, args.include_related === true);
      const sections = [
        `data_version: ${result.gameVersion}`,
        "source: local_currency_war_structured_data",
        "rule: 字段缺失或标记为“本地资料未记录”时，不得根据模型记忆补全。",
        "",
        facts.format(result.records),
      ];
      if (result.unknownNames.length > 0) {
        sections.push("", `unknown_names: ${result.unknownNames.join(", ")}`);
      }
      return sections.join("\n");
    },
  });
}
