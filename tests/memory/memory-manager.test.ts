import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryManager } from "../../src/main/memory/memory-manager.js";
import { createMemoryStore } from "../../src/main/memory/memory-store.js";
import type {
  MemoryCandidate,
  MemoryFile,
} from "../../src/main/memory/memory-types.js";

const directories: string[] = [];

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    layer: "L0",
    field: "preferredName",
    content: "Alex",
    confidence: 0.98,
    importance: "high",
    evidenceQuote: "Call me Alex",
    reason: "model commentary that must not be persisted",
    ...overrides,
  };
}

async function createHarness(options: {
  now?: () => Date;
  idFactory?: () => string;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-memory-manager-"));
  directories.push(directory);
  const store = createMemoryStore({ filePath: join(directory, "memory.json") });
  const manager = createMemoryManager({ store, ...options });
  return { manager, store };
}

function expectEmptyMemory(file: MemoryFile): void {
  expect(file).toEqual({
    schemaVersion: 1,
    l0: { longTermInterests: [], permanentNotes: [] },
    l1: { recentGoals: [], recentPreferences: [] },
    l2: [],
  });
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createMemoryManager", () => {
  it("writes an explicit high-confidence L0 field", async () => {
    const { manager, store } = await createHarness();

    const summary = await manager.writeCandidates({
      userMessage: "我叫小明",
      candidates: [candidate({
        layer: "L0",
        field: "preferredName",
        content: "小明",
        confidence: 0.98,
        importance: "high",
        evidenceQuote: "我叫小明",
      })],
    });

    expect(summary.writtenCount).toBe(1);
    expect((await store.load()).l0.preferredName).toBe("小明");
  });

  it("requires the evidence quote to be an exact user-message substring", async () => {
    const { manager, store } = await createHarness();

    const summary = await manager.writeCandidates({
      userMessage: "Hello",
      candidates: [candidate({ evidenceQuote: "Call me Alex" })],
    });

    expect(summary.writtenCount).toBe(0);
    expect(summary.skippedCount).toBe(1);
    expectEmptyMemory(await store.load());
  });

  it.each([
    { layer: "L0" as const, field: "occupation", confidence: 0.89 },
    { layer: "L1" as const, field: "currentProject", confidence: 0.79 },
    { layer: "L2" as const, field: undefined, confidence: 0.79 },
  ])("skips $layer confidence $confidence below its threshold", async (testCase) => {
    const { manager, store } = await createHarness();
    const evidenceQuote = `Threshold ${testCase.layer}`;

    const summary = await manager.writeCandidates({
      userMessage: evidenceQuote,
      candidates: [candidate({
        ...testCase,
        content: `${testCase.layer} memory`,
        evidenceQuote,
        importance: "medium",
      })],
    });

    expect(summary).toMatchObject({
      candidateCount: 1,
      writtenCount: 0,
      skippedCount: 1,
      writes: [],
    });
    expectEmptyMemory(await store.load());
  });

  it.each([
    { layer: "L0" as const, field: "occupation", confidence: 0.90, write: "L0.occupation" },
    { layer: "L1" as const, field: "currentProject", confidence: 0.80, write: "L1.currentProject" },
    { layer: "L2" as const, field: undefined, confidence: 0.80, write: "L2" },
  ])("accepts $layer confidence at its $confidence boundary", async (testCase) => {
    const { manager } = await createHarness();
    const evidenceQuote = `Boundary ${testCase.layer}`;

    const summary = await manager.writeCandidates({
      userMessage: evidenceQuote,
      candidates: [candidate({
        ...testCase,
        content: `${testCase.layer} boundary memory`,
        evidenceQuote,
        importance: "medium",
      })],
    });

    expect(summary).toEqual({
      candidateCount: 1,
      writtenCount: 1,
      skippedCount: 0,
      writes: [testCase.write],
    });
  });

  it.each([
    {
      label: "secret-looking candidate content",
      content: "sk-example-secret-value",
      evidenceQuote: "the value is shown here",
    },
    {
      label: "API key evidence",
      content: "example-only",
      evidenceQuote: "my api key is sk-example-secret-value",
    },
    {
      label: "password evidence",
      content: "example-only",
      evidenceQuote: "password: example-only",
    },
    {
      label: "access-token evidence",
      content: "example-only",
      evidenceQuote: "access token: example-only",
    },
    {
      label: "bank-card evidence",
      content: "example-only",
      evidenceQuote: "银行卡号 6222020000000000",
    },
    {
      label: "Chinese password evidence",
      content: "example-only",
      evidenceQuote: "密码: example-only",
    },
    {
      label: "Chinese verification-code evidence",
      content: "example-only",
      evidenceQuote: "验证码: 123456",
    },
    {
      label: "identity-document evidence",
      content: "example-only",
      evidenceQuote: "ID card number: example-only",
    },
    {
      label: "exact-address evidence",
      content: "example-only",
      evidenceQuote: "home address: example-only",
    },
  ])("skips $label", async ({ content, evidenceQuote }) => {
    const { manager, store } = await createHarness();

    const summary = await manager.writeCandidates({
      userMessage: `User said ${evidenceQuote}`,
      candidates: [candidate({ content, evidenceQuote })],
    });

    expect(summary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expectEmptyMemory(await store.load());
  });

  it("normalizes and deduplicates array values case-insensitively", async () => {
    const { manager, store } = await createHarness();

    await manager.writeCandidates({
      userMessage: "I enjoy TypeScript",
      candidates: [candidate({
        field: "longTermInterests",
        content: "TypeScript",
        evidenceQuote: "I enjoy TypeScript",
      })],
    });
    const duplicateSummary = await manager.writeCandidates({
      userMessage: "Still into typescript",
      candidates: [candidate({
        field: "longTermInterests",
        content: "  typescript  ",
        evidenceQuote: "Still into typescript",
      })],
    });

    expect(duplicateSummary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect((await store.load()).l0.longTermInterests).toEqual(["TypeScript"]);
  });

  it("normalizes and deduplicates active L2 content case-insensitively", async () => {
    const { manager, store } = await createHarness({
      idFactory: vi.fn()
        .mockReturnValueOnce("memory-1")
        .mockReturnValueOnce("memory-2"),
    });

    await manager.writeCandidates({
      userMessage: "I finished Phase 7A",
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: "Finished Phase 7A",
        evidenceQuote: "I finished Phase 7A",
        importance: "medium",
      })],
    });
    const duplicateSummary = await manager.writeCandidates({
      userMessage: "I FINISHED phase 7a",
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: "  finished   phase 7a  ",
        evidenceQuote: "I FINISHED phase 7a",
        importance: "high",
      })],
    });

    expect(duplicateSummary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect((await store.load()).l2).toHaveLength(1);
  });

  it("injects deterministic L2 identity and time without persisting reason", async () => {
    const { manager, store } = await createHarness({
      now: () => new Date("2026-07-14T08:00:00.000Z"),
      idFactory: () => "memory-1",
    });

    await manager.writeCandidates({
      userMessage: "I finished Phase 7A today",
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: "  Finished   Phase 7A  ",
        confidence: 0.91,
        importance: "high",
        evidenceQuote: "I finished Phase 7A today",
        reason: "inferred event",
      })],
    });

    expect((await store.load()).l2[0]).toEqual({
      id: "memory-1",
      content: "Finished Phase 7A",
      confidence: 0.91,
      evidence: {
        userQuote: "I finished Phase 7A today",
        capturedAt: "2026-07-14T08:00:00.000Z",
      },
      importance: "high",
      createdAt: "2026-07-14T08:00:00.000Z",
      status: "active",
    });
  });

  it("rejects low-importance L2 candidates", async () => {
    const { manager, store } = await createHarness();

    const summary = await manager.writeCandidates({
      userMessage: "I completed a routine task",
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: "Completed a routine task",
        evidenceQuote: "I completed a routine task",
        importance: "low",
      })],
    });

    expect(summary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect((await store.load()).l2).toEqual([]);
  });

  it("enforces layer and field allowlists on untrusted runtime candidates", async () => {
    const { manager, store } = await createHarness();
    const evidenceQuote = "Untrusted candidate";
    const candidates = [
      candidate({ field: "unknownL0Field" }) as MemoryCandidate,
      candidate({ layer: "L1", field: "preferredName" }) as MemoryCandidate,
      candidate({ layer: "L2", field: "currentProject" }),
      candidate({ layer: "L9" as MemoryCandidate["layer"] }),
    ];

    const summary = await manager.writeCandidates({
      userMessage: evidenceQuote,
      candidates: candidates.map((value) => ({ ...value, evidenceQuote })),
    });

    expect(summary).toEqual({
      candidateCount: 4,
      writtenCount: 0,
      skippedCount: 4,
      writes: [],
    });
    expectEmptyMemory(await store.load());
  });

  it("rejects malformed values that reached the security boundary", async () => {
    const { manager, store } = await createHarness();
    const malformed = [
      candidate({ content: "   " }),
      candidate({ evidenceQuote: "" }),
      candidate({ evidenceQuote: "   " }),
      candidate({ confidence: Number.NaN }),
      candidate({ confidence: 1.01 }),
      candidate({ importance: "critical" as MemoryCandidate["importance"] }),
    ];

    const summary = await manager.writeCandidates({
      userMessage: "Call me Alex   ",
      candidates: malformed,
    });

    expect(summary).toMatchObject({
      candidateCount: 6,
      writtenCount: 0,
      skippedCount: 6,
      writes: [],
    });
    expectEmptyMemory(await store.load());
  });

  it("uses one real store transaction and lets valid candidates survive invalid peers", async () => {
    const { manager, store } = await createHarness({
      now: () => new Date("2026-07-14T08:00:00.000Z"),
    });
    const update = vi.spyOn(store, "update");

    const summary = await manager.writeCandidates({
      userMessage: "Call me Alex. I use TypeScript.",
      candidates: [
        candidate(),
        candidate({ evidenceQuote: "not in the user message" }),
        candidate({
          field: "longTermInterests",
          content: "  TypeScript  ",
          evidenceQuote: "I use TypeScript.",
        }),
      ],
    });

    expect(update).toHaveBeenCalledOnce();
    expect(summary).toEqual({
      candidateCount: 3,
      writtenCount: 2,
      skippedCount: 1,
      writes: ["L0.preferredName", "L0.longTermInterests"],
    });
    expect((await store.load()).l0).toEqual({
      preferredName: "Alex",
      longTermInterests: ["TypeScript"],
      permanentNotes: [],
      updatedAt: "2026-07-14T08:00:00.000Z",
    });
  });
});
