export interface PlacementCandidate { name: string; field: string; position: "front" | "back"; }
export interface PlacementIssue { name: string; issue: "POSITION_MISMATCH"; }

export function validatePlacement(candidates: readonly PlacementCandidate[]): PlacementIssue[] {
  return candidates.flatMap((candidate) => {
    const allowed = candidate.field === "前后台" || (candidate.field === "前台" && candidate.position === "front") || (candidate.field === "后台" && candidate.position === "back");
    return allowed ? [] : [{ name: candidate.name, issue: "POSITION_MISMATCH" as const }];
  });
}
