import { describe, expect, it } from "vitest";
import {
  CONVERSATION_SCHEMA_VERSION,
  createEmptyConversation,
} from "../../src/main/conversations/conversation-types.js";
import { migrateConversation } from "../../src/main/conversations/conversation-migrations.js";

describe("conversation migrations", () => {
  it("accepts a valid version-one conversation", () => {
    const record = createEmptyConversation({
      id: "conv_1",
      styleId: "default",
      now: "2026-07-18T00:00:00.000Z",
    });

    expect(migrateConversation(record)).toEqual(record);
    expect(record.schemaVersion).toBe(CONVERSATION_SCHEMA_VERSION);
  });

  it("rejects unknown versions and malformed message protocol fields", () => {
    expect(() => migrateConversation({ schemaVersion: 99 })).toThrow(
      "CONVERSATION_SCHEMA_UNSUPPORTED",
    );
    expect(() => migrateConversation({
      ...createEmptyConversation({
        id: "conv_1",
        styleId: "default",
        now: "2026-07-18T00:00:00.000Z",
      }),
      messages: [{ role: "tool", content: "result" }],
    })).toThrow("CONVERSATION_SCHEMA_INVALID");
  });
});
