export interface CurrencyWarGuidanceDecision {
  shouldRetrieve: boolean;
  reason: "operational-question" | "exact-fact-only" | "not-currency-war";
  query?: string;
}

const OPERATIONAL_TERMS = /怎么做|如何做|应该|优先|升级|升等|刷新|经济|金币|存钱|补战力|补给|奖励|遭遇|战斗|首领|止损|过渡|转型|路线|投资环境|投资策略/u;
const EXACT_FACT_PATTERN = /^(?:.+?)(?:是)?(?:几费|什么羁绊|什么效果|多少层|多少金币|属性是什么)[？?]?$/u;

export function decideCurrencyWarGuidanceRetrieval(input: {
  text: string;
  hasCurrencyWarContext: boolean;
}): CurrencyWarGuidanceDecision {
  if (!input.hasCurrencyWarContext) {
    return { shouldRetrieve: false, reason: "not-currency-war" };
  }
  const text = input.text.trim();
  if (EXACT_FACT_PATTERN.test(text) && !OPERATIONAL_TERMS.test(text)) {
    return { shouldRetrieve: false, reason: "exact-fact-only" };
  }
  if (!OPERATIONAL_TERMS.test(text)) {
    return { shouldRetrieve: false, reason: "exact-fact-only" };
  }
  return {
    shouldRetrieve: true,
    reason: "operational-question",
    query: `货币战争标准博弈最高难度：${text}`,
  };
}
