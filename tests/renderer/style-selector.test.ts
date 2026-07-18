import { describe, expect, it, vi } from "vitest";
import type { CyreneApi } from "../../src/shared/electron-api.js";
import {
  changeSelectedStyle,
  loadSelectedStyle,
} from "../../src/renderer/chat/style-selector.js";

function createPersonaApi(): CyreneApi["persona"] {
  return {
    getStyle: vi.fn(async (_conversationId) => ({ styleId: "healing" as const })),
    setStyle: vi.fn(async (_conversationId, styleId) => ({ styleId })),
  };
}

describe("style selector API helpers", () => {
  it("loads the persisted style", async () => {
    const api = createPersonaApi();

    await expect(loadSelectedStyle(api, "conv_1")).resolves.toBe("healing");
    expect(api.getStyle).toHaveBeenCalledWith("conv_1");
  });

  it("returns the style confirmed by Main", async () => {
    const api = createPersonaApi();

    await expect(changeSelectedStyle(api, "conv_1", "sweet")).resolves.toBe("sweet");
    expect(api.setStyle).toHaveBeenCalledWith("conv_1", "sweet");
  });
});
