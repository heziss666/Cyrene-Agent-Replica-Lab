const MAX_ROUTED_SKILLS = 2;

const ROUTES = [
  {
    id: "currency-war-phainon-counter-armor",
    keywords: ["白厄", "反甲", "反伤", "以牙还牙甲"],
  },
  {
    id: "currency-war-kafka-hysilens-dot",
    keywords: ["卡芙卡", "海瑟音", "持续伤害", "dot"],
  },
  {
    id: "currency-war-himeko-departure-train",
    keywords: ["姬子·启行", "姬子启行", "发车", "列车体系"],
  },
] as const;

export function routeCurrencyWarSkills(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
  return ROUTES
    .filter((route) => route.keywords.some((keyword) =>
      normalized.includes(keyword.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, ""))))
    .map((route) => route.id)
    .slice(0, MAX_ROUTED_SKILLS);
}
