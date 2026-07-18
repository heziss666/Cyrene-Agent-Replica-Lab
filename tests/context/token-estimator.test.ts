import { describe, expect, it } from "vitest";
import { createConservativeTokenEstimator } from "../../src/main/context/token-estimator.js";

describe("conservative token estimator", () => {
  const estimator = createConservativeTokenEstimator();

  it("counts CJK code points and groups latin characters conservatively", () => {
    expect(estimator.estimateText("")).toBe(0);
    expect(estimator.estimateText("你好")).toBe(2);
    expect(estimator.estimateText("abcd")).toBe(1);
    expect(estimator.estimateText("abcde")).toBe(2);
    expect(estimator.estimateText("你好 abcd")).toBe(3);
  });

  it("includes message, tool call, and tool schema overhead", () => {
    const plain = estimator.estimateMessages([{ role: "user", content: "hello" }]);
    const withCall = estimator.estimateMessages([{
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "clock", arguments: "{}" }],
    }]);
    const tools = estimator.estimateTools([{
      name: "clock",
      description: "Read the current time",
      parameters: { type: "object", properties: {} },
    }]);

    expect(plain).toBeGreaterThan(estimator.estimateText("hello"));
    expect(withCall).toBeGreaterThan(4);
    expect(tools).toBeGreaterThan(0);
  });
});
