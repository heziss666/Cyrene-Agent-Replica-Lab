import { describe, expect, it } from "vitest";
import { parseSseData } from "../../src/main/vendors/sse-parser.js";

async function* chunks() { yield "data: {\"a\":"; yield "1}\r\n\r\n: keepalive\n\ndata: [DONE]\n\n"; }
describe("parseSseData", () => {
  it("frames split CRLF events and ignores comments", async () => {
    const values: string[] = []; for await (const value of parseSseData(chunks())) values.push(value);
    expect(values).toEqual(["{\"a\":1}", "[DONE]"]);
  });
});
