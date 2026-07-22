export type ShopOdds = Record<1 | 2 | 3 | 4 | 5, number>;

const SHOP_ODDS: Record<number, ShopOdds> = {
  1: { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0 }, 2: { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0 },
  3: { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0 }, 4: { 1: 65, 2: 25, 3: 10, 4: 0, 5: 0 },
  5: { 1: 45, 2: 33, 3: 20, 4: 2, 5: 0 }, 6: { 1: 30, 2: 40, 3: 25, 4: 5, 5: 0 },
  7: { 1: 19, 2: 30, 3: 40, 4: 10, 5: 1 }, 8: { 1: 18, 2: 25, 3: 32, 4: 22, 5: 3 },
  9: { 1: 15, 2: 20, 3: 25, 4: 30, 5: 10 }, 10: { 1: 5, 2: 10, 3: 20, 4: 40, 5: 25 },
};

export function getShopOdds(level: number): ShopOdds {
  const odds = SHOP_ODDS[level];
  if (!odds) throw new Error("CURRENCY_WAR_SHOP_LEVEL_INVALID");
  return { ...odds };
}
