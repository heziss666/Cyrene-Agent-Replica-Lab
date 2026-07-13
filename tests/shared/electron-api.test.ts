import { describe, expect, it } from "vitest";
import type {
  CyreneApi,
  PersonaStyleResult,
} from "../../src/shared/electron-api.js";

describe("CyreneApi persona contract", () => {
  it("uses a validated style id for get and set results", async () => {
    const result: PersonaStyleResult = { styleId: "healing" };
    const persona: CyreneApi["persona"] = {
      getStyle: async () => result,
      setStyle: async (styleId) => ({ styleId }),
    };

    await expect(persona.getStyle()).resolves.toEqual({ styleId: "healing" });
    await expect(persona.setStyle("sweet")).resolves.toEqual({ styleId: "sweet" });
  });
});
