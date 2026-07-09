import { describe, expect, it } from "vitest";
import {
  formatRendererErrorMessage,
  formatRendererEvent,
  formatRendererEventPayload,
} from "../../src/renderer/chat/renderer-events.js";

describe("formatRendererEvent", () => {
  it("formats agent events for the chat event log", () => {
    expect(
      formatRendererEvent({
        type: "model_call_started",
        round: 1,
        messageCount: 2,
        toolCount: 3,
      }),
    ).toBe("Model round 1 started: 2 messages, 3 tools");

    expect(
      formatRendererEvent({
        type: "tool_call_started",
        round: 1,
        toolCallId: "call_1",
        toolName: "calculator",
        args: { expression: "2 + 2" },
      }),
    ).toBe('Tool calculator started with {"expression":"2 + 2"}');

    expect(
      formatRendererEvent({
        type: "run_error",
        message: "Model request failed",
      }),
    ).toBe("Run failed: Model request failed");
  });
});

describe("formatRendererEventPayload", () => {
  it("prefixes formatted event text with the run id", () => {
    expect(
      formatRendererEventPayload({
        runId: "run_12",
        event: {
          type: "model_call_started",
          round: 1,
          messageCount: 2,
          toolCount: 3,
        },
      }),
    ).toBe("[run_12] Model round 1 started: 2 messages, 3 tools");
  });
});

describe("formatRendererErrorMessage", () => {
  it("formats unknown renderer errors as visible agent messages", () => {
    expect(formatRendererErrorMessage(new Error("Model request failed"))).toBe(
      "请求失败：Model request failed",
    );

    expect(formatRendererErrorMessage("CYRENE_MODEL_API_KEY is required")).toBe(
      "请求失败：CYRENE_MODEL_API_KEY is required",
    );
  });
});
