import { randomUUID } from "node:crypto";
import type { McpRisk, McpTrust } from "./mcp-types.js";

export type McpPermissionPolicy = "allow" | "ask";
export type McpApprovalReason =
  | "APPROVED"
  | "USER_DENIED"
  | "NO_APPROVAL_WINDOW"
  | "APPROVAL_TIMEOUT"
  | "SHUTDOWN";

export interface McpApprovalRequestInput {
  serverId: string;
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface McpApprovalRequest extends McpApprovalRequestInput {
  id: string;
  risk: "sensitive";
}

export interface McpApprovalDecision {
  allowed: boolean;
  reason: McpApprovalReason;
}

export interface McpApprovalBroker {
  request(input: McpApprovalRequestInput): Promise<McpApprovalDecision>;
  resolve(input: { id: string; allowed: boolean }): boolean;
  shutdown(): void;
  pendingCount(): number;
}

export function policyForMcpTool(risk: McpRisk, trust: McpTrust): McpPermissionPolicy {
  return risk === "read" || trust === "trusted" ? "allow" : "ask";
}

export function createMcpApprovalBroker(options: {
  emit: (request: McpApprovalRequest) => boolean;
  timeoutMs?: number;
  createId?: () => string;
  onRequested?: (request: McpApprovalRequest) => void;
  onResolved?: (request: McpApprovalRequest, decision: McpApprovalDecision) => void;
}): McpApprovalBroker {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const createId = options.createId ?? randomUUID;
  const pending = new Map<string, {
    timer: NodeJS.Timeout;
    request: McpApprovalRequest;
    resolve: (decision: McpApprovalDecision) => void;
  }>();
  let shuttingDown = false;

  function settle(id: string, decision: McpApprovalDecision): boolean {
    const item = pending.get(id);
    if (!item) return false;
    pending.delete(id);
    clearTimeout(item.timer);
    item.resolve(decision);
    options.onResolved?.(item.request, decision);
    return true;
  }

  return {
    request(input) {
      if (shuttingDown) return Promise.resolve({ allowed: false, reason: "SHUTDOWN" });
      const id = createId();
      const request: McpApprovalRequest = { id, ...input, risk: "sensitive" };
      return new Promise<McpApprovalDecision>((resolve) => {
        const timer = setTimeout(() => {
          settle(id, { allowed: false, reason: "APPROVAL_TIMEOUT" });
        }, timeoutMs);
        pending.set(id, { timer, request, resolve });
        options.onRequested?.(request);
        let delivered = false;
        try {
          delivered = options.emit(request);
        } catch {
          delivered = false;
        }
        if (!delivered) {
          settle(id, { allowed: false, reason: "NO_APPROVAL_WINDOW" });
        }
      });
    },
    resolve(input) {
      return settle(input.id, input.allowed
        ? { allowed: true, reason: "APPROVED" }
        : { allowed: false, reason: "USER_DENIED" });
    },
    shutdown() {
      shuttingDown = true;
      for (const id of [...pending.keys()]) {
        settle(id, { allowed: false, reason: "SHUTDOWN" });
      }
    },
    pendingCount() {
      return pending.size;
    },
  };
}
