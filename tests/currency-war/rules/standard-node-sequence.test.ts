import { describe, expect, it } from "vitest";
import { getStandardNode, getStandardTransition } from "../../../src/main/currency-war/rules/standard-node-sequence.js";

describe("standard node sequence", () => {
  it("models the complete fixed three-plane standard sequence", () => {
    expect(getStandardNode("1-1")).toMatchObject({ plane: 1, index: 1, type: "reward" });
    expect(getStandardNode("1-9")).toMatchObject({ plane: 1, index: 9, type: "boss" });
    expect(getStandardNode("2-3")).toMatchObject({ plane: 2, index: 3, type: "supply" });
    expect(getStandardNode("3-7")).toMatchObject({ plane: 3, index: 7, type: "boss" });
  });

  it("exposes investment selections between their exact nodes", () => {
    expect(getStandardTransition("1-2")).toEqual({ nextNodeId: "1-3", eventsBeforeNextNode: ["investment_strategy:1"] });
    expect(getStandardTransition("2-1")).toEqual({ nextNodeId: "2-2", eventsBeforeNextNode: ["investment_strategy:2"] });
    expect(getStandardTransition("3-7")).toEqual({ nextNodeId: undefined, eventsBeforeNextNode: [] });
  });

  it("rejects node IDs outside the fixed standard route", () => {
    expect(() => getStandardNode("1-10")).toThrow("CURRENCY_WAR_STANDARD_NODE_UNKNOWN");
  });
});
