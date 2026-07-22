export interface UnitCopy { name: string; star: number; }
export interface StarUpAnalysis { name: string; star: number; copies: number; copiesNeeded: number; }

export function analyzeStarUp(units: readonly UnitCopy[]): StarUpAnalysis[] {
  const counts = new Map<string, number>();
  for (const unit of units) {
    const key = `${unit.name}\u0000${unit.star}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, copies]) => {
    const [name, starText] = key.split("\u0000");
    return { name: name!, star: Number(starText), copies, copiesNeeded: Math.max(0, 3 - copies) };
  });
}
