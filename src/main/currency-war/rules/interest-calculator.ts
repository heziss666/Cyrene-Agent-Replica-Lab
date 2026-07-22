export function calculateStandardInterest(gold: number): number {
  if (!Number.isFinite(gold) || gold < 0) throw new Error("CURRENCY_WAR_GOLD_INVALID");
  return Math.min(5, Math.floor(gold / 10));
}
