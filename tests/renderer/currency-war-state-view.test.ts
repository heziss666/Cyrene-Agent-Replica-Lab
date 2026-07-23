import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { formatNumberedCharacter } from "../../src/renderer/chat/currency-war-equipment-editor.js";

describe("currency war structured state view", () => {
  it("formats equipment targets with the visible sequence number", () => {
    expect(formatNumberedCharacter({
      number: 2,
      instanceId: "unit-2",
      characterName: "黑塔",
      star: 2,
      position: "back",
    })).toBe("2号 黑塔（2星）");
  });

  it("does not retain legacy text parsers or obsolete checkboxes", async () => {
    const source = await readFile(
      new URL("../../src/renderer/chat/currency-war-state-view.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("parseCharacterLines");
    expect(source).not.toContain("shopLocked");
    expect(source).not.toContain("advisorUnlocked");
  });
});
