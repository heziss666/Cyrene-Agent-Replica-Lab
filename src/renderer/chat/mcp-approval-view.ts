import type { McpApi, McpApprovalRequestView } from "../../shared/mcp-api-types.js";

export interface McpApprovalViewController { dispose(): void; }

export function mountMcpApprovalView(options: {
  root: HTMLElement;
  api: Pick<McpApi, "onApprovalRequested" | "resolveApproval">;
  document?: Document;
}): McpApprovalViewController {
  const document = options.document ?? window.document;
  let current: McpApprovalRequestView | undefined;
  async function resolve(allowed: boolean): Promise<void> {
    if (!current) return;
    const id = current.id;
    current = undefined;
    options.root.replaceChildren();
    options.root.hidden = true;
    await options.api.resolveApproval(id, allowed);
  }
  function render(request: McpApprovalRequestView): void {
    if (current) void resolve(false);
    current = request;
    const dialog = document.createElement("section");
    dialog.className = "mcp-approval-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.textContent = "Approve MCP action";
    const tool = document.createElement("code");
    tool.textContent = request.toolId;
    const server = document.createElement("p");
    server.textContent = `Server: ${request.serverId}`;
    const args = document.createElement("pre");
    args.textContent = JSON.stringify(request.args, null, 2);
    const actions = document.createElement("div");
    actions.className = "mcp-approval-actions";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "secondary-button";
    reject.textContent = "Reject";
    const allow = document.createElement("button");
    allow.type = "button";
    allow.textContent = "Allow";
    reject.addEventListener("click", () => resolve(false));
    allow.addEventListener("click", () => resolve(true));
    actions.append(reject, allow);
    dialog.append(title, tool, server, args, actions);
    options.root.replaceChildren(dialog);
    options.root.hidden = false;
    reject.focus();
  }
  const unsubscribe = options.api.onApprovalRequested(render);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && current) void resolve(false);
  };
  document.addEventListener("keydown", onKeyDown);
  options.root.hidden = true;
  return {
    dispose() {
      if (current) void resolve(false);
      unsubscribe();
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
