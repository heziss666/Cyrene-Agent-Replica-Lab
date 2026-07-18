import { describe, expect, it } from "vitest";
import { loadAgentRunConfig } from "../../src/main/config/run-config.js";

describe("agent run config", () => {
  it("uses a shorter scheduler timeout and accepts an override", () => {
    expect(loadAgentRunConfig({})).toMatchObject({ schedulerRunTimeoutMs: 90_000 });
    expect(loadAgentRunConfig({ CYRENE_SCHEDULER_RUN_TIMEOUT_MS: "30000" })).toMatchObject({ schedulerRunTimeoutMs: 30_000 });
  });
});
