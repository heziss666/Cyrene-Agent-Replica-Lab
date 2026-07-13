import { describe, expect, it, vi } from "vitest";
import type { CyreneApi } from "../../src/shared/electron-api.js";
import {
  changeSelectedStyle,
  loadSelectedStyle,
} from "../../src/renderer/chat/style-selector.js";

function createPersonaApi(): CyreneApi["persona"] {
  return {
    getStyle: vi.fn(async () => ({ styleId: "healing" as const })),
    setStyle: vi.fn(async (styleId) => ({ styleId })),
  };
}

describe("style selector API helpers", () => {
  it("loads the persisted style", async () => {
    const api = createPersonaApi();

    await expect(loadSelectedStyle(api)).resolves.toBe("healing");
    expect(api.getStyle).toHaveBeenCalledOnce();
  });

  it("returns the style confirmed by Main", async () => {
    const api = createPersonaApi();

    await expect(changeSelectedStyle(api, "sweet")).resolves.toBe("sweet");
    expect(api.setStyle).toHaveBeenCalledWith("sweet");
  });
});
