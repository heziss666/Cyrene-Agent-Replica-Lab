import { describe, expect, it } from "vitest";
import { migrateGameState } from "../../../src/main/currency-war/state/game-state-migrations.js";

describe("migrateGameState", () => {
  it("fills the complete schema around a legacy minimal state", () => {
    const migrated = migrateGameState({
      mode: "standard",
      difficulty: "highest",
      nodeId: "2-4",
      teamHealth: 72,
      gold: 31,
      level: 7,
      experience: 12,
      board: [{ name: "黑塔", star: 2, position: "back" }],
      bench: [],
      shop: ["翡翠"],
      equipment: ["某装备"],
      investmentEnvironment: null,
      investmentStrategies: [],
      advisorUnlocked: false,
    }, "conversation-1", "2026-07-23T00:00:00.000Z");

    expect(migrated).toMatchObject({
      schemaVersion: 1,
      conversationId: "conversation-1",
      nodeId: "2-4",
      teamHealth: 72,
      board: [{ characterName: "黑塔", star: 2, position: "back" }],
      shop: { locked: false, slots: [{ slot: 1, characterName: "翡翠", star: 1 }] },
      inventory: [{ instanceId: "legacy-equipment-1", equipmentName: "某装备" }],
    });
  });

  it("rejects unknown future schema versions", () => {
    expect(() => migrateGameState({ schemaVersion: 99 }, "conversation-1", "now"))
      .toThrow("GAME_STATE_SCHEMA_UNSUPPORTED");
  });
});
