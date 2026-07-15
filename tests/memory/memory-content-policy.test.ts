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

  it.each([
    "123 Example Street",
    "88 North Harbor Road",
    "221B Baker Street",
    "P.O. Box 123",
    "PO Box 456",
    "\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u5357\u5c71\u533a\u79d1\u6280\u56ed\u8def88\u53f7",
    "\u5317\u4eac\u5e02\u6d77\u6dc0\u533a\u4e2d\u5173\u6751\u5927\u885727\u53f7",
    "\u79d1\u6280\u56ed\u8def88\u53f7",
    "\u5317\u4eac\u5e02\u6d77\u6dc0\u533a\u4e2d\u5173\u6751\u5927\u8857\u4e8c\u5341\u4e03\u53f7",
    "\u4e0a\u6d77\u5e02\u9ec4\u6d66\u533a\u5357\u4eac\u4e1c\u8def88\u5f042\u53f7",
  ])("rejects concrete unlabeled addresses in user edits: %s", (content) => {
    expect(validateUserEditedMemoryContent(content)).toEqual({
      ok: false,
      code: "forbidden_sensitive_data",
    });
  });

  it.each([
    "123 Example Street",
    "88 North Harbor Road",
    "221B Baker Street",
    "P.O. Box 123",
    "PO Box 456",
    "\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u5357\u5c71\u533a\u79d1\u6280\u56ed\u8def88\u53f7",
    "\u4e0a\u6d77\u5e02\u6d66\u4e1c\u65b0\u533a\u4e16\u7eaa\u5927\u9053100\u53f7",
    "\u79d1\u6280\u56ed\u8def88\u53f7",
    "\u5317\u4eac\u5e02\u6d77\u6dc0\u533a\u4e2d\u5173\u6751\u5927\u8857\u4e8c\u5341\u4e03\u53f7",
    "\u4e0a\u6d77\u5e02\u9ec4\u6d66\u533a\u5357\u4eac\u4e1c\u8def88\u5f042\u53f7",
  ])("rejects concrete unlabeled addresses in model evidence: %s", (value) => {
    expect(validateModelMemoryContent({
      userMessage: value,
      evidenceQuote: value,
      content: value,
    })).toEqual({ ok: false, code: "forbidden_sensitive_data" });
  });

  it.each([
    "The 2024 roadmap has 12 milestones",
    "Version 221B is supported",
    "Release v2.21B is ready",
    "The review date is 2026-07-15",
    "Meet me on Main Street after work",
    "I prefer Beijing for the conference",
    "\u6211\u559c\u6b22\u5317\u4eac\u7684\u79d1\u6280\u56ed",
    "\u6211\u559c\u6b22\u4e0a\u6d77",
    "\u6280\u672f\u8def\u7ebf\u670988\u9879\u68c0\u67e5",
  ])("does not reject non-address content as an address: %s", (content) => {
    expect(validateUserEditedMemoryContent(content)).toMatchObject({ ok: true });
  });

  it.each([
    "Version 221B is supported",
    "Release v2.21B is ready",
    "The review date is 2026-07-15",
    "I prefer Beijing for the conference",
    "\u6211\u559c\u6b22\u4e0a\u6d77",
  ])("accepts non-address model evidence: %s", (content) => {
    expect(validateModelMemoryContent({
      userMessage: content,
      evidenceQuote: content,
      content,
    })).toMatchObject({ ok: true });
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

  it.each([
    ["dot-separated token label", "api.key: example-only", "example-only"],
    ["slash-separated token label", "access/token: example-only", "example-only"],
    ["Unicode-hyphen token label", "access\u2011token: example-only", "example-only"],
    ["zero-width-obscured token label", "api\u200B.key: example-only", "example-only"],
    ["variation-selector-obscured token label", "api\uFE0F.key: example-only", "example-only"],
    ["password label", "password: example-only", "example-only"],
    ["Chinese password label", "\u5bc6\u7801: example-only", "example-only"],
    ["Chinese verification-code label", "\u9a8c\u8bc1\u7801: 123456", "123456"],
    ["identity-document label", "ID card number: example-only", "example-only"],
  ])("rejects obscured or compact sensitive label in model evidence: %s", (_label, evidenceQuote, content) => {
    expect(validateModelMemoryContent({
      userMessage: evidenceQuote,
      evidenceQuote,
      content,
    })).toEqual({ ok: false, code: "forbidden_sensitive_data" });
  });

  it.each([
    ["obscured API label", "api\u200B.key: example-only"],
    ["Unicode-hyphen access label", "access\u2011token: example-only"],
    ["Chinese password label", "\u5bc6\u7801: example-only"],
    ["identity-document label", "ID card number: example-only"],
  ])("rejects obscured or compact sensitive label in user edits: %s", (_label, content) => {
    expect(validateUserEditedMemoryContent(content)).toEqual({
      ok: false,
      code: "forbidden_sensitive_data",
    });
  });

  it.each([
    ["JWT with URL-safe ending", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.signature-"],
    ["AWS access key", "AKIAFAKE000000000000"],
    ["Arabic-Indic bank-card digits", "number \u0661\u0662\u0663\u0664.\u0665\u0666\u0667\u0668/\u0669\u0660\u0661\u0662-\u0663\u0664\u0665\u0666"],
  ])("rejects %s in model evidence", (_label, evidenceQuote) => {
    expect(validateModelMemoryContent({
      userMessage: evidenceQuote,
      evidenceQuote,
      content: evidenceQuote,
    })).toEqual({ ok: false, code: "forbidden_sensitive_data" });
  });

  it.each([
    ["Chinese exact address", "\u6211\u7684\u8be6\u7ec6\u5730\u5740\u662f\u793a\u4f8b\u8def123\u53f7", "forbidden_sensitive_data"],
    ["Chinese medical privacy", "\u6211\u88ab\u8bca\u65ad\u60a3\u6709\u793a\u4f8b\u75be\u75c5", "privacy_opt_in_required"],
    ["Chinese legal privacy", "\u6211\u7684\u5f8b\u5e08\u6b63\u5728\u5904\u7406\u79bb\u5a5a\u8bc9\u8bbc", "privacy_opt_in_required"],
  ])("returns the stable code for %s", (_label, evidenceQuote, code) => {
    expect(validateModelMemoryContent({
      userMessage: evidenceQuote,
      evidenceQuote,
      content: evidenceQuote,
    })).toEqual({ ok: false, code });
  });

  it("checks complete long statements and scopes privacy opt-in to the quoted statement", () => {
    const longMedicalStatement = `I was diagnosed with ${"details ".repeat(16)}a heart condition`;
    expect(validateModelMemoryContent({
      userMessage: longMedicalStatement,
      evidenceQuote: "a heart condition",
      content: "a heart condition",
    })).toEqual({ ok: false, code: "privacy_opt_in_required" });

    expect(validateModelMemoryContent({
      userMessage: "Please remember that I like blue. I was diagnosed with cancer.",
      evidenceQuote: "I was diagnosed with cancer",
      content: "I was diagnosed with cancer",
    })).toEqual({ ok: false, code: "privacy_opt_in_required" });

    expect(validateModelMemoryContent({
      userMessage: "Please remember for future conversations that I was diagnosed with cancer.",
      evidenceQuote: "I was diagnosed with cancer",
      content: "I was diagnosed with cancer",
    })).toMatchObject({ ok: true });
  });

  it("returns identical results across repeated model and user-edit calls", () => {
    const modelInput = {
      userMessage: "number 1234.5678/9012-3456",
      evidenceQuote: "number 1234.5678/9012-3456",
      content: "number 1234.5678/9012-3456",
    };
    const modelExpected = { ok: false, code: "forbidden_sensitive_data" } as const;
    const userInput = "api\u200B.key: example-only";
    const userExpected = { ok: false, code: "forbidden_sensitive_data" } as const;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(validateModelMemoryContent(modelInput)).toEqual(modelExpected);
      expect(validateUserEditedMemoryContent(userInput)).toEqual(userExpected);
    }
  });
});
