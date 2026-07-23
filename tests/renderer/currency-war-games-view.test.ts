import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createCurrencyWarGamesOperations } from "../../src/renderer/chat/currency-war-games-operations.js";

describe("currency war games operations", () => {
  it("flushes the editor before deleting the active game", async () => {
    const order: string[] = [];
    const operations = createCurrencyWarGamesOperations({
      api: {
        remove: vi.fn(async () => {
          order.push("remove");
          return { activeGameId: "game-2", games: [], maxGames: 10 };
        }),
        rename: vi.fn(),
      },
      editor: {
        flush: vi.fn(async () => { order.push("flush"); }),
      },
    });

    await expect(operations.remove("game-1")).resolves.toBe("game-2");
    expect(order).toEqual(["flush", "remove"]);
  });

  it("uses an inline rename editor instead of unsupported window.prompt", async () => {
    const source = await readFile(
      new URL("../../src/renderer/chat/currency-war-games-view.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("window.prompt");
    expect(source).toContain("data-game-name");
    expect(source).toContain('data-game-action="save-rename"');
  });
});
