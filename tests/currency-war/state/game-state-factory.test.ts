import { describe, expect, it } from "vitest";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";

describe("createDefaultGameState", () => {
  it("creates a standard highest-difficulty 4.4 state for one conversation", () => {
    const now = "2026-07-23T00:00:00.000Z";
    const state = createDefaultGameState("conversation-1", now);

    expect(state).toMatchObject({
      schemaVersion: 1,
      gameVersion: "4.4",
      conversationId: "conversation-1",
      status: "active",
      mode: "standard",
      difficulty: "highest",
      nodeId: "1-1",
      board: [],
      bench: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(state.shop).toEqual({ locked: false, slots: [] });
  });
});
