import { describe, expect, it } from "vitest";
import { findPossibleConflictCandidate } from "../../src/main/memory/memory-conflict.js";

describe("findPossibleConflictCandidate", () => {
  it("finds a correction when the memories share a concrete topic", () => {
    expect(findPossibleConflictCandidate("I no longer use Python", "I use Python"))
      .toMatchObject({
        isCandidate: true,
        sharedTopic: true,
        correctionIntent: true,
        preferenceEvolution: false,
      });
  });

  it("finds an evolving preference on the same topic", () => {
    expect(findPossibleConflictCandidate("I now prefer light mode", "I prefer dark mode"))
      .toMatchObject({
        isCandidate: true,
        sharedTopic: true,
        correctionIntent: false,
        preferenceEvolution: true,
      });
  });

  it("rejects unrelated memories", () => {
    expect(findPossibleConflictCandidate("I visited Beijing", "I studied Python"))
      .toEqual(expect.objectContaining({ isCandidate: false, sharedTopic: false }));
  });

  it("treats identical normalized content as a duplicate rather than a conflict", () => {
    expect(findPossibleConflictCandidate("  I USE  Python ", "i use python"))
      .toEqual(expect.objectContaining({ isCandidate: false, duplicate: true }));
  });
});
