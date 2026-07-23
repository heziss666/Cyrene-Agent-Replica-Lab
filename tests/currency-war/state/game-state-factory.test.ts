import { describe, expect, it } from "vitest";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";

describe("createDefaultGameState", () => {
  it("creates an independent standard highest-difficulty 4.4 game", () => {
    const now = "2026-07-23T00:00:00.000Z";
    const state = createDefaultGameState("game-1", "测试对局", now);

    expect(state).toMatchObject({
      schemaVersion: 1,
      gameVersion: "4.4",
      gameId: "game-1",
      name: "测试对局",
      status: "active",
      mode: "standard",
      difficulty: "highest",
      nodeId: "1-1",
      board: [],
      bench: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(state).not.toHaveProperty("conversationId");
    expect(state).not.toHaveProperty("specialResources");
    expect(state.shop).toEqual({ locked: false, slots: [] });
  });
});
