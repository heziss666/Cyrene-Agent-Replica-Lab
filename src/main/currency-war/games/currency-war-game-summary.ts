import type { CurrencyWarGameState } from "../../../shared/currency-war-api-types.js";

const positionLabels = { front: "前台", back: "后台", bench: "备战席" } as const;

export function buildCurrencyWarGameSummary(state: CurrencyWarGameState): string {
  const characters = [...state.board, ...state.bench];
  const characterNumbers = new Map(characters.map((unit, index) => [unit.instanceId, index + 1]));
  const inventoryById = new Map(state.inventory.map((item) => [item.instanceId, item]));
  const characterById = new Map(characters.map((unit) => [unit.instanceId, unit]));
  const lines = [
    `# 货币战争对局：${state.name}`,
    `节点：${state.nodeId}`,
    `状态：${state.status}`,
    `生命：${state.teamHealth}`,
    `经济：${state.gold} 金币，等级 ${state.level}，经验 ${state.experience}，连胜 ${state.winStreak ?? "未记录"}`,
    "",
    "## 阵容",
    ...orEmpty(characters.map((unit, index) =>
      `${index + 1}号 ${unit.characterName}（${unit.cost}费，${unit.star}星，${positionLabels[unit.position]}）`
    )),
    "",
    "## 商店",
    ...orEmpty(state.shop.slots.map((slot) =>
      `${slot.slot}号位：${slot.characterName ? `${slot.characterName}（${slot.cost}费，${slot.star}星）` : "空"}`
    )),
    "",
    "## 装备库存",
    ...orEmpty(state.inventory.map((item) => `${item.equipmentName} × ${item.quantity}`)),
    "",
    "## 装备分配",
    ...orEmpty(state.equipmentAssignments.flatMap((assignment) => {
      const unit = characterById.get(assignment.characterInstanceId);
      const equipment = inventoryById.get(assignment.equipmentInstanceId);
      if (!unit || !equipment) return [];
      return [`${characterNumbers.get(unit.instanceId)}号 ${unit.characterName}：${equipment.equipmentName} × ${assignment.quantity}`];
    })),
    "",
    `投资环境：${state.investmentEnvironment ?? "未选择"}`,
    `投资策略：${state.investmentStrategies.map((item) => `${item.plane}面 ${item.strategyName}`).join("；") || "未选择"}`,
    `已解锁顾问：${state.advisorState.unlocked ? state.advisorState.name ?? "未填写" : "无"}`,
  ];
  if (state.notes.trim()) lines.push(`备注：${state.notes.trim()}`);
  return lines.join("\n");
}

function orEmpty(lines: string[]): string[] {
  return lines.length > 0 ? lines : ["无"];
}
