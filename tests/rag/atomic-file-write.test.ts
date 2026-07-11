import { describe, expect, it, vi } from "vitest";
import {
  writeFileAtomically,
  type AtomicFileOperations,
} from "../../src/main/rag/atomic-file-write.js";

function operations(): AtomicFileOperations {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  };
}

describe("writeFileAtomically", () => {
  it("writes a same-directory temporary file then renames it", async () => {
    const ops = operations();

    await writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops);

    expect(ops.writeFile).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json.tmp",
      "{}",
      "utf8",
    );
    expect(ops.rename).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json.tmp",
      "C:\\rag\\vector-index.json",
    );
  });

  it("uses a backup when direct replacement is denied", async () => {
    const ops = operations();
    vi.mocked(ops.rename)
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))
      .mockResolvedValue(undefined);

    await writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops);

    expect(ops.rename).toHaveBeenNthCalledWith(
      2,
      "C:\\rag\\vector-index.json",
      "C:\\rag\\vector-index.json.bak",
    );
    expect(ops.rename).toHaveBeenNthCalledWith(
      3,
      "C:\\rag\\vector-index.json.tmp",
      "C:\\rag\\vector-index.json",
    );
    expect(ops.rm).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json.bak",
      { force: true },
    );
  });

  it("restores the backup when the fallback replacement fails", async () => {
    const ops = operations();
    vi.mocked(ops.rename)
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("replacement failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops),
    ).rejects.toThrow("replacement failed");

    expect(ops.rename).toHaveBeenNthCalledWith(
      4,
      "C:\\rag\\vector-index.json.bak",
      "C:\\rag\\vector-index.json",
    );
  });
});
