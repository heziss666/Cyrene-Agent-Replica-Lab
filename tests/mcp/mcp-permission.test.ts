import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMcpApprovalBroker,
  policyForMcpTool,
} from "../../src/main/mcp/mcp-permission.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("MCP permission", () => {
  it("allows read tools and asks only for untrusted sensitive tools", () => {
    expect(policyForMcpTool("read", "ask-sensitive")).toBe("allow");
    expect(policyForMcpTool("sensitive", "ask-sensitive")).toBe("ask");
    expect(policyForMcpTool("sensitive", "trusted")).toBe("allow");
  });

  it("resolves a pending approval exactly once", async () => {
    let approvalId = "";
    const broker = createMcpApprovalBroker({
      emit: (request) => {
        approvalId = request.id;
        return true;
      },
    });
    const pending = broker.request({
      serverId: "demo",
      toolId: "demo__write",
      toolName: "write",
      args: { path: "a.txt" },
    });

    expect(broker.pendingCount()).toBe(1);
    expect(broker.resolve({ id: approvalId, allowed: false })).toBe(true);
    expect(broker.resolve({ id: approvalId, allowed: true })).toBe(false);
    await expect(pending).resolves.toEqual({ allowed: false, reason: "USER_DENIED" });
  });

  it("denies when no window receives the request or when it times out", async () => {
    const noWindow = createMcpApprovalBroker({ emit: () => false });
    await expect(noWindow.request({
      serverId: "demo",
      toolId: "demo__write",
      toolName: "write",
      args: {},
    })).resolves.toEqual({ allowed: false, reason: "NO_APPROVAL_WINDOW" });

    vi.useFakeTimers();
    const broker = createMcpApprovalBroker({ emit: () => true, timeoutMs: 60_000 });
    const pending = broker.request({
      serverId: "demo",
      toolId: "demo__write",
      toolName: "write",
      args: {},
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toEqual({ allowed: false, reason: "APPROVAL_TIMEOUT" });
  });

  it("rejects all pending requests during shutdown", async () => {
    const broker = createMcpApprovalBroker({ emit: () => true });
    const pending = broker.request({
      serverId: "demo",
      toolId: "demo__write",
      toolName: "write",
      args: {},
    });

    broker.shutdown();

    await expect(pending).resolves.toEqual({ allowed: false, reason: "SHUTDOWN" });
    expect(broker.pendingCount()).toBe(0);
  });
});
