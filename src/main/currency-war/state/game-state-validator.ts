import type { CurrencyWarCatalog } from "../data/currency-war-catalog.js";
import type { CurrencyWarEntityType } from "../data/currency-war-data-types.js";
import { getStandardNode, getStandardTransition, type StandardNode } from "../rules/standard-node-sequence.js";
import type {
  CurrencyWarGameState,
  CurrencyWarValidationIssue,
} from "../../../shared/currency-war-api-types.js";

export interface GameStateValidationResult {
  valid: boolean;
  issues: CurrencyWarValidationIssue[];
  node?: StandardNode;
  transition?: ReturnType<typeof getStandardTransition>;
}

export function validateGameState(
  input: unknown,
  catalog?: CurrencyWarCatalog,
): GameStateValidationResult {
  const issues: CurrencyWarValidationIssue[] = [];
  if (!isRecord(input)) {
    return { valid: false, issues: [issue("STATE_INVALID", "", "对局状态必须是对象")] };
  }

  checkExact(input.mode, "standard", "MODE_UNSUPPORTED", "mode", "仅支持标准博弈", issues);
  checkExact(input.difficulty, "highest", "DIFFICULTY_UNSUPPORTED", "difficulty", "仅支持最高难度", issues);
  for (const field of ["teamHealth", "gold", "level", "experience"] as const) {
    if (!isNonNegativeInteger(input[field])) {
      issues.push(issue("VALUE_INVALID", field, `${field} 必须是非负整数`));
    }
  }
  if (input.winStreak !== null && !isNonNegativeInteger(input.winStreak)) {
    issues.push(issue("VALUE_INVALID", "winStreak", "连胜必须为空或非负整数"));
  }

  let node: StandardNode | undefined;
  let transition: ReturnType<typeof getStandardTransition> | undefined;
  if (typeof input.nodeId === "string") {
    try {
      node = getStandardNode(input.nodeId);
      transition = getStandardTransition(input.nodeId);
    } catch {
      issues.push(issue("NODE_UNKNOWN", "nodeId", "节点不在标准博弈固定路线中"));
    }
  } else {
    issues.push(issue("NODE_UNKNOWN", "nodeId", "节点不在标准博弈固定路线中"));
  }

  const board = arrayValue(input.board);
  const bench = arrayValue(input.bench);
  if (isNonNegativeInteger(input.level) && board.length > input.level) {
    issues.push(issue("BOARD_EXCEEDS_LEVEL", "board", "上阵角色数量不能超过当前等级"));
  }
  validateCharacters([
    ...board.map((item, index) => ({ item, path: `board.${index}` })),
    ...bench.map((item, index) => ({ item, path: `bench.${index}` })),
  ], catalog, issues);
  validateShop(input.shop, catalog, issues);
  validateInventoryAndAssignments(input, catalog, issues);
  validateInvestments(input, node, catalog, issues);

  return { valid: !issues.some((item) => item.severity === "error"), issues, node, transition };
}

function validateCharacters(
  entries: Array<{ item: unknown; path: string }>,
  catalog: CurrencyWarCatalog | undefined,
  issues: CurrencyWarValidationIssue[],
): void {
  const ids = new Set<string>();
  entries.forEach(({ item, path }) => {
    if (!isRecord(item)) {
      issues.push(issue("CHARACTER_INVALID", path, "角色实例格式无效"));
      return;
    }
    if (typeof item.instanceId !== "string" || !item.instanceId) {
      issues.push(issue("CHARACTER_INSTANCE_ID_INVALID", `${path}.instanceId`, "角色实例缺少唯一 ID"));
    } else if (ids.has(item.instanceId)) {
      issues.push(issue("CHARACTER_INSTANCE_DUPLICATE", `${path}.instanceId`, "角色实例 ID 重复"));
    } else {
      ids.add(item.instanceId);
    }
    if (typeof item.characterName !== "string" || !entityExists(catalog, "characters", item.characterName)) {
      issues.push(issue("ENTITY_UNKNOWN", `${path}.characterName`, "角色不在 4.4 数据中"));
    }
    if (!Number.isInteger(item.star) || (item.star as number) < 1) {
      issues.push(issue("VALUE_INVALID", `${path}.star`, "角色星级必须是正整数"));
    }
  });
}

function validateShop(
  value: unknown,
  catalog: CurrencyWarCatalog | undefined,
  issues: CurrencyWarValidationIssue[],
): void {
  if (!isRecord(value) || !Array.isArray(value.slots)) {
    issues.push(issue("SHOP_INVALID", "shop", "商店格式无效"));
    return;
  }
  value.slots.forEach((slot, index) => {
    if (!isRecord(slot)) return;
    if (typeof slot.characterName === "string" && !entityExists(catalog, "characters", slot.characterName)) {
      issues.push(issue("ENTITY_UNKNOWN", `shop.slots.${index}.characterName`, "商店角色不在 4.4 数据中"));
    }
  });
}

function validateInventoryAndAssignments(
  state: Record<string, unknown>,
  catalog: CurrencyWarCatalog | undefined,
  issues: CurrencyWarValidationIssue[],
): void {
  const inventory = arrayValue(state.inventory);
  const inventoryIds = new Set<string>();
  inventory.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (typeof item.instanceId === "string") inventoryIds.add(item.instanceId);
    if (typeof item.equipmentName !== "string" || !entityExists(catalog, "equipment", item.equipmentName)) {
      issues.push(issue("ENTITY_UNKNOWN", `inventory.${index}.equipmentName`, "装备不在 4.4 数据中"));
    }
  });
  const characterIds = new Set(
    [...arrayValue(state.board), ...arrayValue(state.bench)]
      .filter(isRecord)
      .map((item) => item.instanceId)
      .filter((id): id is string => typeof id === "string"),
  );
  const assignmentCounts = new Map<string, number>();
  const assignedEquipment = new Set<string>();
  arrayValue(state.equipmentAssignments).forEach((assignment, index) => {
    if (!isRecord(assignment)) return;
    const equipmentId = assignment.equipmentInstanceId;
    const characterId = assignment.characterInstanceId;
    if (typeof equipmentId !== "string" || !inventoryIds.has(equipmentId)) {
      issues.push(issue("EQUIPMENT_INSTANCE_UNKNOWN", `equipmentAssignments.${index}.equipmentInstanceId`, "分配的装备不在库存中"));
    } else if (assignedEquipment.has(equipmentId)) {
      issues.push(issue("EQUIPMENT_ASSIGNED_TWICE", `equipmentAssignments.${index}.equipmentInstanceId`, "同一装备不能重复分配"));
    } else {
      assignedEquipment.add(equipmentId);
    }
    if (typeof characterId !== "string" || !characterIds.has(characterId)) {
      issues.push(issue("CHARACTER_INSTANCE_UNKNOWN", `equipmentAssignments.${index}.characterInstanceId`, "装备目标角色不存在"));
    } else {
      assignmentCounts.set(characterId, (assignmentCounts.get(characterId) ?? 0) + 1);
    }
  });
  if ([...assignmentCounts.values()].some((count) => count > 3)) {
    issues.push(issue("EQUIPMENT_LIMIT_EXCEEDED", "equipmentAssignments", "每个角色最多装备 3 件装备"));
  }
}

function validateInvestments(
  state: Record<string, unknown>,
  node: StandardNode | undefined,
  catalog: CurrencyWarCatalog | undefined,
  issues: CurrencyWarValidationIssue[],
): void {
  if (typeof state.investmentEnvironment === "string"
    && !entityExists(catalog, "investment_environments", state.investmentEnvironment)) {
    issues.push(issue("ENTITY_UNKNOWN", "investmentEnvironment", "投资环境不在 4.4 数据中"));
  }
  arrayValue(state.investmentStrategies).forEach((selection, index) => {
    if (!isRecord(selection)) return;
    const path = `investmentStrategies.${index}`;
    if (typeof selection.strategyName !== "string"
      || !entityExists(catalog, "investment_strategies", selection.strategyName)) {
      issues.push(issue("ENTITY_UNKNOWN", `${path}.strategyName`, "投资策略不在 4.4 数据中"));
    }
    if (node && typeof selection.plane === "number" && selection.plane > reachedStrategyPlane(node)) {
      issues.push(issue("STRATEGY_PLANE_NOT_REACHED", `${path}.plane`, "尚未到达该位面的投资策略选择时点"));
    }
  });
}

function reachedStrategyPlane(node: StandardNode): number {
  if (node.plane === 1) return node.index >= 3 ? 1 : 0;
  return node.index >= 2 ? node.plane : node.plane - 1;
}

function entityExists(catalog: CurrencyWarCatalog | undefined, type: CurrencyWarEntityType, name: string): boolean {
  return !catalog || catalog.list(type).some((entity) => entity.name === name) || catalog.getByName(name)?.name === name;
}

function checkExact(
  actual: unknown,
  expected: string,
  code: string,
  path: string,
  message: string,
  issues: CurrencyWarValidationIssue[],
): void {
  if (actual !== expected) issues.push(issue(code, path, message));
}

function issue(code: string, path: string, message: string): CurrencyWarValidationIssue {
  return { code, path, severity: "error", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isCurrencyWarGameState(value: unknown): value is CurrencyWarGameState {
  return validateGameState(value).valid;
}
