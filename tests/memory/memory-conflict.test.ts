import { describe, expect, it, vi } from "vitest";
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

  it("finds a Chinese correction with a shared Han topic", () => {
    expect(findPossibleConflictCandidate(
      "\u6211\u4e0d\u518d\u4f7f\u7528\u5fae\u4fe1",
      "\u6211\u4f7f\u7528\u5fae\u4fe1",
    )).toMatchObject({
      isCandidate: true,
      sharedTopic: true,
      correctionIntent: true,
      preferenceEvolution: false,
    });
  });

  it("finds an evolving Chinese preference with a shared Han topic", () => {
    expect(findPossibleConflictCandidate(
      "\u6211\u73b0\u5728\u66f4\u559c\u6b22\u6d45\u8272\u6a21\u5f0f",
      "\u6211\u559c\u6b22\u6df1\u8272\u6a21\u5f0f",
    )).toMatchObject({
      isCandidate: true,
      sharedTopic: true,
      correctionIntent: false,
      preferenceEvolution: true,
    });
  });

  it("does not create a Chinese candidate from cues without a shared topic", () => {
    expect(findPossibleConflictCandidate(
      "\u6211\u73b0\u5728\u66f4\u559c\u6b22\u5496\u5561",
      "\u6211\u559c\u6b22\u65c5\u884c",
    )).toEqual(expect.objectContaining({ isCandidate: false, sharedTopic: false }));
  });

  it("rejects unrelated memories", () => {
    expect(findPossibleConflictCandidate("I visited Beijing", "I studied Python"))
      .toEqual(expect.objectContaining({ isCandidate: false, sharedTopic: false }));
  });

  it("treats identical normalized content as a duplicate rather than a conflict", () => {
    expect(findPossibleConflictCandidate("  I USE  Python ", "i use python"))
      .toEqual(expect.objectContaining({ isCandidate: false, duplicate: true }));
  });

  it("treats normalized Chinese content as a duplicate rather than a conflict", () => {
    expect(findPossibleConflictCandidate(
      "  \u6211\u559c\u6b22\u6d45\u8272\u6a21\u5f0f  ",
      "\u6211\u559c\u6b22\u6d45\u8272\u6a21\u5f0f",
    )).toEqual(expect.objectContaining({ isCandidate: false, duplicate: true }));
  });

  it("does not depend on locale-sensitive lowercasing", () => {
    const localeLower = vi.spyOn(String.prototype, "toLocaleLowerCase");

    findPossibleConflictCandidate("I no longer use Python", "I use Python");

    expect(localeLower).not.toHaveBeenCalled();
  });
});
