import { describe, expect, it } from "vitest";
import { chunkDocument } from "../../src/main/rag/chunk-text.js";
import type { KnowledgeDocument } from "../../src/main/rag/rag-types.js";

function makeDocument(text: string): KnowledgeDocument {
  return {
    id: "doc_1",
    title: "Test Document",
    text,
    source: "test",
  };
}

describe("chunkDocument", () => {
  it("returns one chunk when the text fits in the chunk size", () => {
    const chunks = chunkDocument(makeDocument("short text"), {
      chunkSizeChars: 100,
      overlapChars: 20,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      id: "doc_1_chunk_0",
      documentId: "doc_1",
      title: "Test Document",
      text: "short text",
      source: "test",
      index: 0,
    });
  });

  it("creates overlapping chunks for long text", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const chunks = chunkDocument(makeDocument(text), {
      chunkSizeChars: 10,
      overlapChars: 3,
    });

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "abcdefghij",
      "hijklmnopq",
      "opqrstuvwx",
      "vwxyz",
    ]);
  });

  it("rejects an overlap that is not smaller than the chunk size", () => {
    expect(() =>
      chunkDocument(makeDocument("abc"), {
        chunkSizeChars: 10,
        overlapChars: 10,
      }),
    ).toThrow("overlapChars must be smaller than chunkSizeChars");
  });

  it("ignores blank text", () => {
    const chunks = chunkDocument(makeDocument("   \n\t  "));
    expect(chunks).toEqual([]);
  });
});
