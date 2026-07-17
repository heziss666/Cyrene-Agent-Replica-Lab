import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../src/main/agent/agent-events.js";
import { formatAgentEventForTerminal } from "../../src/main/agent/agent-events.js";
import { formatRendererEvent } from "../../src/renderer/chat/renderer-events.js";

describe("skill events", () => {
  it("formats activation, reference, and safe failure events", () => {
    const events: AgentEvent[] = [
      { type: "skill_activated", skillId: "tutor" },
      { type: "skill_reference_loaded", skillId: "tutor", reference: "guide.md" },
      { type: "skill_load_failed", skillId: "tutor", code: "SKILL_DISABLED" },
    ];

    expect(events.map(formatAgentEventForTerminal)).toEqual([
      "[skill] activated id=tutor",
      "[skill] reference loaded id=tutor reference=guide.md",
      "[skill] load failed id=tutor code=SKILL_DISABLED",
    ]);
    expect(events.map(formatRendererEvent)).toEqual([
      "Skill activated: tutor",
      "Skill reference loaded: tutor/guide.md",
      "Skill load failed: tutor (SKILL_DISABLED)",
    ]);
  });
});
