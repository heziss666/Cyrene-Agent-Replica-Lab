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
  it("cleans up the temporary path when writing it fails", async () => {
    const ops = operations();
    const writeError = new Error("write failed");
    vi.mocked(ops.writeFile).mockRejectedValueOnce(writeError);

    await expect(
      writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops),
    ).rejects.toBe(writeError);

    const temporaryPath = vi.mocked(ops.writeFile).mock.calls[0][0];
    expect(ops.rm).toHaveBeenCalledWith(temporaryPath, { force: true });
  });

  it("uses a writer-unique same-directory temporary file", async () => {
    const ops = operations();

    await writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops);
    await writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops);

    const firstTemporaryPath = vi.mocked(ops.writeFile).mock.calls[0][0];
    const secondTemporaryPath = vi.mocked(ops.writeFile).mock.calls[1][0];
    expect(firstTemporaryPath).toMatch(
      /^C:\\rag\\vector-index\.json\..+\.tmp$/,
    );
    expect(secondTemporaryPath).not.toBe(firstTemporaryPath);
    expect(ops.rename).toHaveBeenCalledWith(firstTemporaryPath, "C:\\rag\\vector-index.json");
    expect(ops.rename).toHaveBeenCalledWith(secondTemporaryPath, "C:\\rag\\vector-index.json");
  });

  it("uses a backup when direct replacement is denied", async () => {
    const ops = operations();
    vi.mocked(ops.rename)
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))
      .mockResolvedValue(undefined);

    await writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops);

    const temporaryPath = vi.mocked(ops.writeFile).mock.calls[0][0];

    expect(ops.rename).toHaveBeenNthCalledWith(
      2,
      "C:\\rag\\vector-index.json",
      "C:\\rag\\vector-index.json.bak",
    );
    expect(ops.rename).toHaveBeenNthCalledWith(
      3,
      temporaryPath,
      "C:\\rag\\vector-index.json",
    );
    expect(ops.rm).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json.bak",
      { force: true },
    );
    expect(vi.mocked(ops.rm).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ops.rename).mock.invocationCallOrder[1],
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

  it("preserves the primary write error when temporary cleanup fails", async () => {
    const ops = operations();
    const writeError = new Error("write failed");
    vi.mocked(ops.writeFile).mockRejectedValueOnce(writeError);
    vi.mocked(ops.rm).mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(
      writeFileAtomically("C:\\rag\\vector-index.json", "{}", ops),
    ).rejects.toBe(writeError);
  });

  it("preserves the formal file when stale backup retirement fails and allows retry", async () => {
    const ops = operations();
    const replacementDenied = Object.assign(new Error("denied"), {
      code: "EPERM",
    });
    vi.mocked(ops.rename)
      .mockRejectedValueOnce(replacementDenied)
      .mockRejectedValueOnce(replacementDenied)
      .mockResolvedValue(undefined);
    vi.mocked(ops.rm)
      .mockRejectedValueOnce(new Error("backup locked"))
      .mockResolvedValue(undefined);

    await expect(
      writeFileAtomically("C:\\rag\\vector-index.json", "first", ops),
    ).rejects.toThrow(
      "Failed to retire stale backup C:\\rag\\vector-index.json.bak: backup locked",
    );
    expect(ops.rename).not.toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json",
      "C:\\rag\\vector-index.json.bak",
    );

    await expect(
      writeFileAtomically("C:\\rag\\vector-index.json", "second", ops),
    ).resolves.toBeUndefined();
    expect(ops.rename).toHaveBeenCalledWith(
      "C:\\rag\\vector-index.json",
      "C:\\rag\\vector-index.json.bak",
    );
  });
});
