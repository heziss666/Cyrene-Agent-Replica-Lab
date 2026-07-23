import { describe, expect, it } from "vitest";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";
import { buildCurrencyWarAgentContext } from "../../../src/main/currency-war/state/game-state-agent-context.js";

describe("buildCurrencyWarAgentContext", () => {
  it("renders compact current-state facts and fixed node transition", () => {
    const state = createDefaultGameState("conversation-1");
    state.nodeId = "1-3";
    state.gold = 20;
    state.board = [{ instanceId: "u1", characterName: "黑塔", star: 2, position: "back" }];

    const context = buildCurrencyWarAgentContext(state, []);

    expect(context).toContain("## 当前货币战争对局");
    expect(context).toContain("版本：4.4");
    expect(context).toContain("模式：标准博弈 / 最高难度");
    expect(context).toContain("节点：1-3（战斗）");
    expect(context).toContain("下一节点：1-4");
    expect(context).toContain("黑塔（2星，后排）");
    expect(context).not.toContain("备注：");
  });
});
