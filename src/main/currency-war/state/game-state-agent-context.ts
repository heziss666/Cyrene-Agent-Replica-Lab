import type {
  CurrencyWarGameState,
  CurrencyWarValidationIssue,
} from "../../../shared/currency-war-api-types.js";
import { getStandardNode, getStandardTransition } from "../rules/standard-node-sequence.js";

const NODE_LABELS = {
  reward: "奖励",
  combat: "战斗",
  supply: "补给",
  encounter: "遭遇",
  boss: "首领",
} as const;

const POSITION_LABELS = {
  front: "前排",
  back: "后排",
  bench: "备战席",
} as const;

export function buildCurrencyWarAgentContext(
  state: CurrencyWarGameState,
  issues: readonly CurrencyWarValidationIssue[],
): string {
  const node = getStandardNode(state.nodeId);
  const transition = getStandardTransition(state.nodeId);
  const lines = [
    "## 当前货币战争对局",
    "以下状态由用户手动录入，只读；不要虚构未录入的信息，也不要声称已修改状态。",
    `版本：${state.gameVersion}`,
    "模式：标准博弈 / 最高难度",
    `节点：${node.id}（${NODE_LABELS[node.type]}）`,
    `下一节点：${transition.nextNodeId ?? "最终结算"}`,
    `生命：${state.teamHealth}`,
    `经济：${state.gold} 金币，等级 ${state.level}，经验 ${state.experience}，连胜 ${state.winStreak ?? "未录入"}`,
    `上阵：${formatCharacters(state.board)}`,
    `备战席：${formatCharacters(state.bench)}`,
    `商店：${state.shop.slots.map((slot) => slot.characterName ?? "空").join("、") || "未录入"}${state.shop.locked ? "（已锁定）" : ""}`,
    `库存装备：${state.inventory.map((item) => item.equipmentName).join("、") || "无/未录入"}`,
    `投资环境：${state.investmentEnvironment ?? "未选择"}`,
    `投资策略：${state.investmentStrategies.map((item) => `${item.plane}面-${item.strategyName}`).join("、") || "未选择"}`,
    `顾问：${state.advisorState.unlocked ? state.advisorState.name ?? "已解锁（未录入名称）" : "未解锁"}`,
  ];
  if (state.notes.trim()) lines.push(`备注：${state.notes.trim()}`);
  if (issues.length > 0) {
    lines.push(`状态提醒：${issues.map((item) => `${item.path || "state"}：${item.message}`).join("；")}`);
  }
  return lines.join("\n");
}

function formatCharacters(characters: CurrencyWarGameState["board"]): string {
  return characters.map((unit) =>
    `${unit.characterName}（${unit.star}星，${POSITION_LABELS[unit.position]}）`
  ).join("、") || "未录入";
}
