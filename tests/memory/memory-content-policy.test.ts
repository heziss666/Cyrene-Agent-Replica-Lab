import { describe, expect, it } from "vitest";
import {
  normalizeMemoryContent,
  validateModelMemoryContent,
  validateUserEditedMemoryContent,
} from "../../src/main/memory/memory-content-policy.js";

describe("memory content policy", () => {
  it("normalizes whitespace and compatibility characters without removing meaningful Unicode", () => {
    const womanTechnologist = "\u{1F469}\u200D\u{1F4BB}";
    const persianWithZwnj = "\u0645\u06CC\u200C\u0631\u0648\u0645";
    const airplaneEmoji = "\u2708\uFE0F";

    expect(normalizeMemoryContent("  Ａｌｅｘ\n  Smith  ")).toBe("Alex Smith");
    expect(normalizeMemoryContent(womanTechnologist)).toBe(womanTechnologist);
    expect(normalizeMemoryContent(persianWithZwnj)).toBe(persianWithZwnj);
    expect(normalizeMemoryContent(airplaneEmoji)).toBe(airplaneEmoji);
  });

  it("accepts exactly 2,000 normalized characters and rejects 2,001", () => {
    const accepted = "x".repeat(2_000);
    const rejected = "x".repeat(2_001);

    expect(validateUserEditedMemoryContent(accepted)).toEqual({
      ok: true,
      content: accepted,
    });
    expect(validateUserEditedMemoryContent(rejected)).toEqual({
      ok: false,
      code: "too_long",
    });
  });

  it("accepts a user edit without evidence or model privacy opt-in", () => {
    expect(validateUserEditedMemoryContent("I have cancer")).toMatchObject({ ok: true });
    expect(validateUserEditedMemoryContent("My lawyer filed a custody lawsuit"))
      .toMatchObject({ ok: true });
  });

  it("rejects empty user edits", () => {
    expect(validateUserEditedMemoryContent("   ")).toEqual({ ok: false, code: "empty" });
    expect(validateUserEditedMemoryContent("\u200B")).toEqual({ ok: false, code: "empty" });
  });

  it.each([
    "ghp_FAKE000000000000000000000000000000000",
    "123-45-6789",
    "my exact address is 123 Example Street",
    "password: example-only",
  ])("permanently rejects sensitive user edits: %s", (content) => {
    expect(validateUserEditedMemoryContent(content)).toEqual({
      ok: false,
      code: "forbidden_sensitive_data",
    });
  });

  it("normalizes accepted user edits in the result", () => {
    expect(validateUserEditedMemoryContent("  Ａｌｅｘ\n  Smith  ")).toEqual({
      ok: true,
      content: "Alex Smith",
    });
  });

  it("requires an evidence quote to be an exact user-message substring", () => {
    expect(validateModelMemoryContent({
      userMessage: "Hello",
      evidenceQuote: "Call me Alex",
      content: "Alex",
    })).toEqual({ ok: false, code: "unsupported_evidence" });
  });

  it("requires model content to be supported by the evidence substring", () => {
    expect(validateModelMemoryContent({
      userMessage: "Call me Alex",
      evidenceQuote: "Call me Alex",
      content: "Alex is a cardiologist",
    })).toEqual({ ok: false, code: "unsupported_evidence" });
    expect(validateModelMemoryContent({
      userMessage: "Call me Alex",
      evidenceQuote: "Call me Alex",
      content: "  Alex  ",
    })).toEqual({ ok: true, content: "Alex" });
  });

  it.each([
    ["I am not a cardiologist", "I am a cardiologist"],
    ["I do not like coffee", "like coffee"],
    ["Alice defeated Bob", "Bob defeated Alice"],
  ])("rejects model evidence transformations", (evidenceQuote, content) => {
    expect(validateModelMemoryContent({
      userMessage: evidenceQuote,
      evidenceQuote,
      content,
    })).toEqual({ ok: false, code: "unsupported_evidence" });
  });

  it("rejects medical and legal model content without scoped explicit opt-in", () => {
    expect(validateModelMemoryContent({
      userMessage: "I have cancer",
      evidenceQuote: "I have cancer",
      content: "I have cancer",
    })).toEqual({ ok: false, code: "privacy_opt_in_required" });
    expect(validateModelMemoryContent({
      userMessage: "My lawyer filed a custody lawsuit",
      evidenceQuote: "My lawyer filed a custody lawsuit",
      content: "My lawyer filed a custody lawsuit",
    })).toEqual({ ok: false, code: "privacy_opt_in_required" });
  });

  it("allows a medical or legal model memory only with a scoped explicit opt-in", () => {
    expect(validateModelMemoryContent({
      userMessage: "Please remember for future conversations that I have cancer",
      evidenceQuote: "I have cancer",
      content: "I have cancer",
    })).toEqual({ ok: true, content: "I have cancer" });
    expect(validateModelMemoryContent({
      userMessage: "请长期记住我的律师正在处理离婚诉讼",
      evidenceQuote: "我的律师正在处理离婚诉讼",
      content: "我的律师正在处理离婚诉讼",
    })).toEqual({ ok: true, content: "我的律师正在处理离婚诉讼" });
  });

  it("does not use an unrelated opt-in sentence for model privacy", () => {
    expect(validateModelMemoryContent({
      userMessage: "Please remember for future conversations that I like blue. I have cancer.",
      evidenceQuote: "I have cancer",
      content: "I have cancer",
    })).toEqual({ ok: false, code: "privacy_opt_in_required" });
  });

  it.each([
    "ghp_FAKE000000000000000000000000000000000",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fake_signature",
    "123-45-6789",
    "my exact address is 123 Example Street",
    "I have cancer",
  ])("rejects sensitive or privacy-bearing model content without changing permanent secret rules: %s", (value) => {
    const result = validateModelMemoryContent({
      userMessage: value,
      evidenceQuote: value,
      content: value,
    });
    expect(result).toEqual(
      value === "I have cancer"
        ? { ok: false, code: "privacy_opt_in_required" }
        : { ok: false, code: "forbidden_sensitive_data" },
    );
  });
});
