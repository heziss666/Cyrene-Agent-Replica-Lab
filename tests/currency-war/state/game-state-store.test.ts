import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultGameState } from "../../../src/main/currency-war/state/game-state-factory.js";
import { createCurrencyWarGameStateStore } from "../../../src/main/currency-war/state/game-state-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const rootDir = await mkdtemp(join(tmpdir(), "game-state-store-"));
  roots.push(rootDir);
  const store = createCurrencyWarGameStateStore({ rootDir });
  await store.initialize();
  return { rootDir, store };
}

describe("CurrencyWarGameStateStore", () => {
  it("returns null for a missing conversation and persists a state atomically", async () => {
    const { rootDir, store } = await setup();
    expect(await store.load("conversation-1")).toBeNull();

    const state = createDefaultGameState("conversation-1");
    state.gold = 20;
    await store.save(state);

    expect(await store.load("conversation-1")).toMatchObject({ conversationId: "conversation-1", gold: 20 });
    expect(JSON.parse(await readFile(join(rootDir, "conversation-1.json"), "utf8"))).toMatchObject({ gold: 20 });
  });

  it("isolates conversations and serializes repeated writes", async () => {
    const { store } = await setup();
    const first = createDefaultGameState("first");
    const second = createDefaultGameState("second");
    first.gold = 1;
    second.gold = 2;
    await Promise.all([store.save(first), store.save(second)]);

    const latest = { ...first, gold: 99 };
    await Promise.all([store.save({ ...first, gold: 10 }), store.save(latest)]);
    await store.flush();

    expect((await store.load("first"))?.gold).toBe(99);
    expect((await store.load("second"))?.gold).toBe(2);
  });

  it("removes one conversation state", async () => {
    const { store } = await setup();
    await store.save(createDefaultGameState("conversation-1"));
    await store.remove("conversation-1");
    expect(await store.load("conversation-1")).toBeNull();
  });
});
