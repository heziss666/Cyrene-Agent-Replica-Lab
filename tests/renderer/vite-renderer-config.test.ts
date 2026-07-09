import { describe, expect, it } from "vitest";
import config from "../../vite.renderer.config.js";

describe("vite renderer config", () => {
  it("uses relative asset paths so Electron loadFile can load renderer scripts and styles", () => {
    expect(config.base).toBe("./");
  });
});
