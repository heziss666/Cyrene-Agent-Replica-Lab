import type {
  CurrencyWarCharacterInstance,
  CurrencyWarCharacterOption,
  CurrencyWarEquipmentAssignment,
} from "../../shared/currency-war-api-types.js";

export function formatNumberedCharacter(
  unit: CurrencyWarCharacterInstance & { number: number },
): string {
  return `${unit.number}号 ${unit.characterName}（${unit.star}星）`;
}

export function removeCharacterAssignments(
  assignments: readonly CurrencyWarEquipmentAssignment[],
  characterInstanceId: string,
): CurrencyWarEquipmentAssignment[] {
  return assignments.filter((item) => item.characterInstanceId !== characterInstanceId);
}

export function removeInventoryAssignments(
  assignments: readonly CurrencyWarEquipmentAssignment[],
  equipmentInstanceId: string,
): CurrencyWarEquipmentAssignment[] {
  return assignments.filter((item) => item.equipmentInstanceId !== equipmentInstanceId);
}

export function getAdvisorOptions(
  options: readonly CurrencyWarCharacterOption[],
): CurrencyWarCharacterOption[] {
  return options.filter(({ advisor }) => advisor);
}
