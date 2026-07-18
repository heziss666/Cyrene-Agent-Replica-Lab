import type { McpApi, McpServerConfigInput, McpSnapshotView } from "../../shared/mcp-api-types.js";
import { sortMcpServers, toMcpServerViewModel } from "./mcp-view-model.js";

export interface McpViewController { show(): Promise<void>; }

export function mountMcpView(options: {
  root: HTMLElement;
  api: McpApi;
  document?: Document;
}): McpViewController {
  const document = options.document ?? window.document;
  const header = document.createElement("header");
  header.className = "mcp-header";
  const heading = document.createElement("h2");
  heading.textContent = "MCP Servers";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "secondary-button";
  addButton.textContent = "Add Server";
  header.append(heading, addButton);
  const status = document.createElement("p");
  status.className = "mcp-status";
  const content = document.createElement("div");
  content.className = "mcp-content";
  const expandedServers = new Set<string>();

  async function run(message: string, action: () => Promise<McpSnapshotView>): Promise<void> {
    status.textContent = message;
    try {
      const snapshot = await action();
      render(snapshot);
      status.textContent = `${snapshot.servers.length} Servers`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  const form = createAddForm(document, async (config) => {
    await run("Connecting...", () => options.api.add(config));
    form.hidden = true;
  });
  form.hidden = true;
  options.root.replaceChildren(header, status, form, content);

  function render(snapshot: McpSnapshotView): void {
    const rows: HTMLElement[] = [];
    for (const server of sortMcpServers(snapshot.servers)) {
      const model = toMcpServerViewModel(server);
      const row = document.createElement("section");
      row.className = "mcp-server-row";
      const top = document.createElement("div");
      top.className = "mcp-server-top";
      const identity = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = server.name;
      const id = document.createElement("code");
      id.textContent = server.id;
      const metadata = document.createElement("p");
      metadata.className = "mcp-metadata";
      metadata.textContent = `${server.transport} | ${model.statusLabel} | ${server.toolCount} tools`;
      identity.append(title, id, metadata);
      const actions = document.createElement("div");
      actions.className = "mcp-actions";
      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "icon-button mcp-expand-button";
      expand.textContent = expandedServers.has(server.id) ? "Collapse" : `Tools (${server.toolCount})`;
      expand.setAttribute("aria-expanded", String(expandedServers.has(server.id)));
      expand.addEventListener("click", () => {
        if (expandedServers.has(server.id)) expandedServers.delete(server.id);
        else expandedServers.add(server.id);
        render(snapshot);
      });
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = server.enabled;
      enabled.title = "Enable server";
      enabled.addEventListener("change", () => run("Saving...", () =>
        options.api.setEnabled(server.id, enabled.checked)));
      const trust = document.createElement("select");
      trust.title = "Trust mode";
      trust.append(makeOption(document, "ask-sensitive", "Ask for sensitive"));
      trust.append(makeOption(document, "trusted", "Trusted"));
      trust.value = server.trust;
      trust.addEventListener("change", () => run("Saving...", () => options.api.update(
        server.id,
        { trust: trust.value as "ask-sensitive" | "trusted" },
      )));
      const reconnect = document.createElement("button");
      reconnect.type = "button";
      reconnect.className = "icon-button mcp-reconnect";
      reconnect.title = "Reconnect";
      reconnect.textContent = "↻";
      reconnect.disabled = !model.canReconnect;
      reconnect.addEventListener("click", () => run("Reconnecting...", () => options.api.reconnect(server.id)));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button danger-button";
      remove.title = "Remove server";
      remove.textContent = "×";
      remove.addEventListener("click", () => run("Removing...", () => options.api.remove(server.id)));
      actions.append(expand, enabled, trust, reconnect, remove);
      top.append(identity, actions);
      row.append(top);
      if (server.errorCode) {
        const error = document.createElement("p");
        error.className = "mcp-error";
        error.textContent = server.errorCode;
        row.append(error);
      }
      const tools = document.createElement("div");
      tools.className = "mcp-tools";
      tools.hidden = !expandedServers.has(server.id);
      for (const tool of server.tools) {
        const toolRow = document.createElement("div");
        toolRow.className = "mcp-tool-row";
        const toolMain = document.createElement("div");
        const toolName = document.createElement("code");
        toolName.textContent = tool.name;
        const description = document.createElement("span");
        description.textContent = tool.description;
        toolMain.append(toolName, description);
        const controls = document.createElement("div");
        const toolEnabled = document.createElement("input");
        toolEnabled.type = "checkbox";
        toolEnabled.checked = tool.enabled;
        toolEnabled.title = "Enable tool";
        const risk = document.createElement("select");
        risk.title = "Tool risk";
        risk.append(makeOption(document, "read", "Read"), makeOption(document, "sensitive", "Sensitive"));
        risk.value = tool.risk;
        const save = () => run("Saving...", () => options.api.setToolOptions(
          server.id,
          tool.name,
          { enabled: toolEnabled.checked, risk: risk.value as "read" | "sensitive" },
        ));
        toolEnabled.addEventListener("change", save);
        risk.addEventListener("change", save);
        controls.append(toolEnabled, risk);
        toolRow.append(toolMain, controls);
        tools.append(toolRow);
      }
      if (server.tools.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No tools available.";
        tools.append(empty);
      }
      row.append(tools);
      rows.push(row);
    }
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No MCP Servers configured.";
      rows.push(empty);
    }
    content.replaceChildren(...rows);
  }

  addButton.addEventListener("click", () => { form.hidden = !form.hidden; });
  return { show: () => run("Loading...", () => options.api.list()) };
}

function createAddForm(document: Document, submit: (config: McpServerConfigInput) => Promise<void>): HTMLElement {
  const form = document.createElement("section");
  form.className = "mcp-add-form";
  const id = makeInput(document, "Server ID");
  const name = makeInput(document, "Display name");
  const transport = document.createElement("select");
  transport.append(makeOption(document, "stdio", "Local stdio"));
  transport.append(makeOption(document, "streamable-http", "Streamable HTTP"));
  transport.value = "stdio";
  const commandOrUrl = makeInput(document, "Command or URL");
  const args = makeInput(document, "Arguments as JSON array");
  args.value = "[]";
  const references = makeInput(document, "Environment/header references as JSON");
  references.value = "{}";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Connect";
  save.addEventListener("click", async () => {
    const base = {
      id: id.value.trim(), name: name.value.trim(), enabled: true,
      trust: "ask-sensitive" as const, toolOverrides: {},
    };
    if (transport.value === "streamable-http") {
      await submit({ ...base, transport: "streamable-http", url: commandOrUrl.value.trim(), headers: parseRecord(references.value) });
    } else {
      await submit({ ...base, transport: "stdio", command: commandOrUrl.value.trim(), args: parseArray(args.value), env: parseRecord(references.value) });
    }
  });
  form.append(id, name, transport, commandOrUrl, args, references, save);
  return form;
}

function makeInput(document: Document, placeholder: string): HTMLInputElement {
  const element = document.createElement("input");
  element.type = "text";
  element.placeholder = placeholder;
  return element;
}

function makeOption(document: Document, value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function parseArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("Arguments must be a JSON string array");
  return parsed;
}

function parseRecord(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    || Object.values(parsed).some((item) => typeof item !== "string")) {
    throw new Error("References must be a JSON string object");
  }
  return parsed as Record<string, string>;
}
