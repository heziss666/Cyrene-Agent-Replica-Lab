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

  it("preserves meaningful ZWJ, ZWNJ, and variation selectors in stored content", async () => {
    const { manager, store } = await createHarness();
    const womanTechnologist = "\u{1F469}\u200D\u{1F4BB}";
    const persianWithZwnj = "\u0645\u06cc\u200C\u0631\u0648\u0645";
    const airplaneEmoji = "\u2708\uFE0F";
    const values = [womanTechnologist, persianWithZwnj, airplaneEmoji];

    const summary = await manager.writeCandidates({
      userMessage: values.join(" | "),
      candidates: values.map((content) => candidate({
        field: "longTermInterests",
        content,
        evidenceQuote: content,
      })),
    });

    expect(summary).toMatchObject({ writtenCount: 3, skippedCount: 0 });
    expect((await store.load()).l0.longTermInterests).toEqual(values);
    expect((await store.load()).l0.longTermInterests[0]).toBe("👩‍💻");
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
    const { manager, store } = await createHarness();
    const evidenceQuote = `Boundary ${testCase.layer}`;
    const content = `${testCase.layer} boundary memory`;

    const summary = await manager.writeCandidates({
      userMessage: evidenceQuote,
      candidates: [candidate({
        ...testCase,
        content,
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

    const stored = await store.load();
    if (testCase.layer === "L0") {
      expect(stored.l0.occupation).toBe(content);
    } else if (testCase.layer === "L1") {
      expect(stored.l1.currentProject).toBe(content);
    } else {
      expect(stored.l2).toHaveLength(1);
      expect(stored.l2[0]).toMatchObject({ content, confidence: 0.80 });
    }
  });

  it.each([
    {
      label: "secret-looking candidate content",
      content: "sk-example-secret-value",
      evidenceQuote: "the value is shown here",
    },
    {
      label: "secret-looking content after a leading underscore",
      content: "_sk-example-secret-value",
      evidenceQuote: "the underscored value is shown here",
    },
    {
      label: "API key evidence",
      content: "example-only",
      evidenceQuote: "my api key is sk-example-secret-value",
    },
    {
      label: "dot-separated API key evidence",
      content: "example-only",
      evidenceQuote: "api.key: example-only",
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
      label: "slash-separated access-token evidence",
      content: "example-only",
      evidenceQuote: "access/token: example-only",
    },
    {
      label: "Unicode-hyphen access-token evidence",
      content: "example-only",
      evidenceQuote: "access\u2011token: example-only",
    },
    {
      label: "zero-width-obscured API key evidence",
      content: "example-only",
      evidenceQuote: "api\u200B.key: example-only",
    },
    {
      label: "variation-selector-obscured API key evidence",
      content: "example-only",
      evidenceQuote: "api\uFE0F.key: example-only",
    },
    {
      label: "Unicode-hyphen secret-looking candidate content",
      content: "sk\u2010example-secret-value",
      evidenceQuote: "the Unicode-hyphen value is shown here",
    },
    {
      label: "bank-card evidence",
      content: "example-only",
      evidenceQuote: "银行卡号 6222020000000000",
    },
    {
      label: "punctuation-separated bank-card-like evidence",
      content: "example-only",
      evidenceQuote: "number 6222.0200/0000-0000",
    },
    {
      label: "punctuation-separated Arabic-Indic bank-card-like evidence",
      content: "example-only",
      evidenceQuote: "number \u0661\u0662\u0663\u0664.\u0665\u0666\u0667\u0668/\u0669\u0660\u0661\u0662-\u0663\u0664\u0665\u0666",
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

  it("case-folds Unicode expansions when deduplicating array values", async () => {
    const { manager, store } = await createHarness();

    await manager.writeCandidates({
      userMessage: "I enjoy Straße",
      candidates: [candidate({
        field: "longTermInterests",
        content: "Straße",
        evidenceQuote: "I enjoy Straße",
      })],
    });
    const duplicateSummary = await manager.writeCandidates({
      userMessage: "I still enjoy STRASSE",
      candidates: [candidate({
        field: "longTermInterests",
        content: "STRASSE",
        evidenceQuote: "I still enjoy STRASSE",
      })],
    });

    expect(duplicateSummary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect((await store.load()).l0.longTermInterests).toEqual(["Straße"]);
  });

  it("renormalizes after case mapping when deduplicating array values", async () => {
    const { manager, store } = await createHarness();
    const composed = "\u0130";
    const canonicallyEquivalent = "i\u0307";

    await manager.writeCandidates({
      userMessage: composed,
      candidates: [candidate({
        field: "longTermInterests",
        content: composed,
        evidenceQuote: composed,
      })],
    });
    const duplicateSummary = await manager.writeCandidates({
      userMessage: canonicallyEquivalent,
      candidates: [candidate({
        field: "longTermInterests",
        content: canonicallyEquivalent,
        evidenceQuote: canonicallyEquivalent,
      })],
    });

    expect(duplicateSummary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect((await store.load()).l0.longTermInterests).toEqual([composed]);
  });

  it("normalizes and deduplicates active L2 content case-insensitively", async () => {
    const idFactory = vi.fn()
      .mockReturnValueOnce("memory-1")
      .mockReturnValueOnce("memory-2");
    const now = vi.fn()
      .mockReturnValueOnce(new Date("2026-07-14T08:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-07-14T09:00:00.000Z"));
    const { manager, store } = await createHarness({
      idFactory,
      now,
    });

    await manager.writeCandidates({
      userMessage: "I finished Phase 7A",
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: "Finished Phase 7A",
        confidence: 0.91,
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
        confidence: 0.99,
        evidenceQuote: "I FINISHED phase 7a",
        importance: "high",
      })],
    });

    expect(duplicateSummary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect(idFactory).toHaveBeenCalledOnce();
    expect((await store.load()).l2).toEqual([{
      id: "memory-1",
      content: "Finished Phase 7A",
      confidence: 0.91,
      evidence: {
        userQuote: "I finished Phase 7A",
        capturedAt: "2026-07-14T08:00:00.000Z",
      },
      importance: "medium",
      createdAt: "2026-07-14T08:00:00.000Z",
      status: "active",
    }]);
  });

  it("case-folds Unicode expansions while preserving the original L2 record", async () => {
    const idFactory = vi.fn()
      .mockReturnValueOnce("memory-1")
      .mockReturnValueOnce("memory-2");
    const { manager, store } = await createHarness({
      idFactory,
      now: () => new Date("2026-07-14T08:00:00.000Z"),
    });

    await manager.writeCandidates({
      userMessage: "I visited Straße",
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: "Visited Straße",
        confidence: 0.91,
        evidenceQuote: "I visited Straße",
        importance: "medium",
      })],
    });
    const duplicateSummary = await manager.writeCandidates({
      userMessage: "I visited STRASSE",
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: "VISITED STRASSE",
        confidence: 0.99,
        evidenceQuote: "I visited STRASSE",
        importance: "high",
      })],
    });

    expect(duplicateSummary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect(idFactory).toHaveBeenCalledOnce();
    expect((await store.load()).l2).toEqual([{
      id: "memory-1",
      content: "Visited Straße",
      confidence: 0.91,
      evidence: {
        userQuote: "I visited Straße",
        capturedAt: "2026-07-14T08:00:00.000Z",
      },
      importance: "medium",
      createdAt: "2026-07-14T08:00:00.000Z",
      status: "active",
    }]);
  });

  it("renormalizes after case mapping while preserving the original L2 record", async () => {
    const idFactory = vi.fn()
      .mockReturnValueOnce("memory-1")
      .mockReturnValueOnce("memory-2");
    const { manager, store } = await createHarness({
      idFactory,
      now: () => new Date("2026-07-14T08:00:00.000Z"),
    });
    const composed = "\u0130";
    const canonicallyEquivalent = "i\u0307";

    await manager.writeCandidates({
      userMessage: composed,
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: composed,
        confidence: 0.91,
        evidenceQuote: composed,
        importance: "medium",
      })],
    });
    const duplicateSummary = await manager.writeCandidates({
      userMessage: canonicallyEquivalent,
      candidates: [candidate({
        layer: "L2",
        field: undefined,
        content: canonicallyEquivalent,
        confidence: 0.99,
        evidenceQuote: canonicallyEquivalent,
        importance: "high",
      })],
    });

    expect(duplicateSummary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expect(idFactory).toHaveBeenCalledOnce();
    expect((await store.load()).l2).toEqual([{
      id: "memory-1",
      content: composed,
      confidence: 0.91,
      evidence: {
        userQuote: composed,
        capturedAt: "2026-07-14T08:00:00.000Z",
      },
      importance: "medium",
      createdAt: "2026-07-14T08:00:00.000Z",
      status: "active",
    }]);
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

  it.each([
    { label: "content", content: "\u200B", evidenceQuote: "zero-width content" },
    { label: "evidence", content: "Alex", evidenceQuote: "\u200B" },
    { label: "variation-selector content", content: "\uFE0F", evidenceQuote: "variation-selector content" },
    { label: "variation-selector evidence", content: "Alex", evidenceQuote: "\uFE0F" },
  ])("rejects format-only Unicode $label as blank", async ({ content, evidenceQuote }) => {
    const { manager, store } = await createHarness();

    const summary = await manager.writeCandidates({
      userMessage: `User text ${evidenceQuote}`,
      candidates: [candidate({ content, evidenceQuote })],
    });

    expect(summary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
    expectEmptyMemory(await store.load());
  });

  it.each([
    { label: "missing", reason: undefined as unknown as string },
    { label: "non-string", reason: 42 as unknown as string },
  ])("rejects a runtime candidate with a $label reason", async ({ reason }) => {
    const { manager, store } = await createHarness();

    const summary = await manager.writeCandidates({
      userMessage: "Call me Alex",
      candidates: [candidate({ reason })],
    });

    expect(summary).toMatchObject({ writtenCount: 0, skippedCount: 1 });
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
