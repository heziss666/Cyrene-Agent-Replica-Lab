import { describe, expect, it } from "vitest";
import {
  getAdvisorOptions,
  removeCharacterAssignments,
  removeInventoryAssignments,
} from "../../src/renderer/chat/currency-war-equipment-editor.js";

const assignments = [
  { equipmentInstanceId: "e1", characterInstanceId: "u1" },
  { equipmentInstanceId: "e2", characterInstanceId: "u2" },
];

describe("currency war equipment editor", () => {
  it("removes assignments when a character is deleted", () => {
    expect(removeCharacterAssignments(assignments, "u1")).toEqual([
      { equipmentInstanceId: "e2", characterInstanceId: "u2" },
    ]);
  });

  it("removes assignments when inventory equipment is deleted", () => {
    expect(removeInventoryAssignments(assignments, "e2")).toEqual([
      { equipmentInstanceId: "e1", characterInstanceId: "u1" },
    ]);
  });

  it("returns only advisor-capable characters", () => {
    expect(getAdvisorOptions([
      { name: "普通角色", costs: [1], advisor: false },
      { name: "顾问角色", costs: [2], advisor: true },
    ]).map(({ name }) => name)).toEqual(["顾问角色"]);
  });
});
