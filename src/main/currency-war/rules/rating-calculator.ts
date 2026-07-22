export function calculateStandardRatingPromotion(teamHealth: number): 1 | 2 | 3 {
  if (!Number.isFinite(teamHealth) || teamHealth < 0) throw new Error("CURRENCY_WAR_TEAM_HEALTH_INVALID");
  return teamHealth >= 70 ? 3 : teamHealth >= 40 ? 2 : 1;
}
