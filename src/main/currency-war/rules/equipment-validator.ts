export interface EquipmentAssignment { equipment: string; character: string; }
export interface EquipmentAssignmentIssue { character: string; issue: "EQUIPMENT_LIMIT_EXCEEDED"; }

export function validateEquipmentAssignments(assignments: readonly EquipmentAssignment[]): EquipmentAssignmentIssue[] {
  const counts = new Map<string, number>();
  for (const assignment of assignments) counts.set(assignment.character, (counts.get(assignment.character) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 3)
    .map(([character]) => ({ character, issue: "EQUIPMENT_LIMIT_EXCEEDED" as const }));
}
