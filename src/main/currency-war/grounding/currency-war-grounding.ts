import type { CurrencyWarFactRecord, CurrencyWarFactService } from "./currency-war-facts.js";
import { routeCurrencyWarSkills } from "./currency-war-skill-router.js";

const MAX_SKILL_CONTENT_CHARS = 32_000;

export interface CurrencyWarGroundingSkillRegistry {
  get(id: string): {
    id: string;
    enabled: boolean;
    available: boolean;
    references: Array<{ name: string }>;
  } | undefined;
  readBody(id: string): Promise<string>;
  readReference(id: string, name: string): Promise<string>;
}

export interface CurrencyWarGroundingBuilder {
  build(text: string): Promise<string>;
}

export interface CreateCurrencyWarGroundingBuilderOptions {
  facts: CurrencyWarFactService;
  skills: CurrencyWarGroundingSkillRegistry;
}

export function createCurrencyWarGroundingBuilder(
  options: CreateCurrencyWarGroundingBuilderOptions,
): CurrencyWarGroundingBuilder {
  return {
    async build(text) {
      const directFacts = options.facts.matchText(text);
      const routedIds = routeCurrencyWarSkills(text);
      const loadedSkills: string[] = [];
      const skillTextForFactMatching: string[] = [];

      for (const skillId of routedIds) {
        const entry = options.skills.get(skillId);
        if (!entry) {
          loadedSkills.push(`### ${skillId}\n[error] SKILL_NOT_FOUND`);
          continue;
        }
        if (!entry.enabled) {
          loadedSkills.push(`### ${skillId}\n[error] SKILL_DISABLED`);
          continue;
        }
        if (!entry.available) {
          loadedSkills.push(`### ${skillId}\n[error] SKILL_UNAVAILABLE`);
          continue;
        }
        try {
          const body = await options.skills.readBody(skillId);
          const references = await Promise.all(entry.references.map(async ({ name }) => ({
            name,
            content: await options.skills.readReference(skillId, name),
          })));
          const content = [
            body,
            ...references.map(({ name, content }) => `#### Reference: ${name}\n${content}`),
          ].join("\n\n");
          const bounded = content.length > MAX_SKILL_CONTENT_CHARS
            ? `${content.slice(0, MAX_SKILL_CONTENT_CHARS)}\n[攻略内容因长度限制已截断]`
            : content;
          loadedSkills.push(`### ${skillId}\n${bounded}`);
          skillTextForFactMatching.push(bounded);
        } catch (error) {
          const code = error instanceof Error && /^SKILL_[A-Z_]+$/.test(error.message)
            ? error.message
            : "SKILL_LOAD_FAILED";
          loadedSkills.push(`### ${skillId}\n[error] ${code}`);
        }
      }

      const referencedFacts = options.facts.matchText(skillTextForFactMatching.join("\n"));
      const allFacts = deduplicateFacts([...directFacts, ...referencedFacts]);
      if (allFacts.length === 0 && loadedSkills.length === 0) return "";

      return [
        "## 货币战争本轮证据包",
        `数据版本：${options.facts.gameVersion}`,
        "结构化事实来源：local_currency_war_structured_data",
        "",
        "### 基础库事实",
        options.facts.format(allFacts),
        ...(loadedSkills.length > 0
          ? ["", "### 已加载攻略 Skill", ...loadedSkills]
          : []),
        "",
        "### 使用约束",
        "- 只允许根据本证据包和本轮工具结果陈述游戏事实。",
        "- 字段缺失或标记为“本地资料未记录”时，不得根据模型记忆补全。",
        "- 基础库记录实体事实；Skill 提供攻略经验；结合当前局面得出的内容必须标记为策略推导。",
      ].join("\n");
    },
  };
}

function deduplicateFacts(records: CurrencyWarFactRecord[]): CurrencyWarFactRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.type}:${record.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
