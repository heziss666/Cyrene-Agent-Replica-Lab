import { describe, expect, it, vi } from "vitest";
import type {
  CurrencyWarStateApi,
  CurrencyWarStatePatch,
  CurrencyWarStateUpdateResult,
} from "../../src/shared/currency-war-api-types.js";
import { createDefaultGameState } from "../../src/main/currency-war/state/game-state-factory.js";
import { createCurrencyWarStateViewModel } from "../../src/renderer/chat/currency-war-state-view-model.js";

function setup() {
  const state = createDefaultGameState("conv_1");
  const update = vi.fn(async (_id: string, patch: CurrencyWarStatePatch): Promise<CurrencyWarStateUpdateResult> => ({
    state: { ...state, ...patch },
    saved: true,
    valid: true,
    issues: [],
  }));
  const api = {
    get: vi.fn(async (id) => ({ ...state, conversationId: id })),
    create: vi.fn(async () => state),
    update,
    reset: vi.fn(async () => state),
    validate: vi.fn(async () => ({ valid: true, issues: [] })),
  } satisfies CurrencyWarStateApi;
  const model = createCurrencyWarStateViewModel({ api, debounceMs: 100 });
  return { api, model, update };
}

describe("CurrencyWarStateViewModel", () => {
  it("loads one conversation and debounce-saves only the latest edit", async () => {
    vi.useFakeTimers();
    const { model, update } = setup();
    await model.load("conv_1");
    model.edit({ gold: 10 });
    model.edit({ gold: 20 });

    expect(model.snapshot().saveStatus).toBe("dirty");
    await vi.advanceTimersByTimeAsync(100);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("conv_1", expect.objectContaining({ gold: 20 }));
    expect(model.snapshot().saveStatus).toBe("saved");
    vi.useRealTimers();
  });

  it("flushes pending edits before loading another conversation", async () => {
    vi.useFakeTimers();
    const { api, model, update } = setup();
    await model.load("conv_1");
    model.edit({ notes: "first" });
    await model.load("conv_2");

    expect(update).toHaveBeenCalledWith("conv_1", expect.objectContaining({ notes: "first" }));
    expect(api.get).toHaveBeenLastCalledWith("conv_2");
    vi.useRealTimers();
  });

  it("keeps local edits and exposes issues when the service rejects a save", async () => {
    vi.useFakeTimers();
    const { api, model } = setup();
    vi.mocked(api.update).mockResolvedValueOnce({
      state: createDefaultGameState("conv_1"),
      saved: false,
      valid: false,
      issues: [{ code: "VALUE_INVALID", path: "level", severity: "error", message: "等级无效" }],
    });
    await model.load("conv_1");
    model.edit({ level: -1 });
    await model.flush();

    expect(model.snapshot()).toMatchObject({
      state: { level: -1 },
      saveStatus: "error",
      issues: [{ path: "level" }],
    });
    vi.useRealTimers();
  });
});
