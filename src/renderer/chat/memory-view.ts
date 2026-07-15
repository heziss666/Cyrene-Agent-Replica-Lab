import type { CyreneApi } from "../../shared/electron-api.js";
import type {
  MemoryApi,
  MemoryLayer,
  MemoryMutationResult,
  MemoryProfileLayer,
  MemorySnapshot,
  UpdateProfileFieldInput,
} from "../../shared/memory-api-types.js";
import type { L0Field, L1Field } from "../../main/memory/memory-types.js";
import {
  filterL2Rows,
  getOverviewCounts,
  mapMutationError,
  MemoryViewModel,
  type L2Filters,
  type MemoryTab,
} from "./memory-view-model.js";

export interface MemoryViewOptions {
  root: HTMLElement;
  api: CyreneApi["memory"];
  confirm?: (message: string) => boolean | Promise<boolean>;
  document?: Document;
}

export interface MemoryViewController {
  show(): Promise<void>;
  refresh(): Promise<void>;
  setTab(tab: MemoryTab): void;
}

type ProfileField = {
  layer: MemoryProfileLayer;
  field: L0Field | L1Field;
  label: string;
  array: boolean;
};

const TABS: Array<{ id: MemoryTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "profile", label: "Profile" },
  { id: "events", label: "Events" },
  { id: "conflicts", label: "Conflicts" },
  { id: "reflections", label: "Reflections" },
  { id: "audit", label: "Audit" },
  { id: "relations", label: "Relations" },
];

const PROFILE_FIELDS: ProfileField[] = [
  { layer: "L0", field: "preferredName", label: "Preferred name", array: false },
  { layer: "L0", field: "occupation", label: "Occupation", array: false },
  { layer: "L0", field: "longTermInterests", label: "Long-term interests", array: true },
  { layer: "L0", field: "language", label: "Language", array: false },
  { layer: "L0", field: "permanentNotes", label: "Permanent notes", array: true },
  { layer: "L1", field: "currentProject", label: "Current project", array: false },
  { layer: "L1", field: "recentGoals", label: "Recent goals", array: true },
  { layer: "L1", field: "recentPreferences", label: "Recent preferences", array: true },
];

const L2_STATUSES = ["all", "active", "aging", "archived", "superseded", "merged"] as const;

export function mountMemoryView(options: MemoryViewOptions): MemoryViewController {
  const document = options.document ?? window.document;
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  let model: MemoryViewModel | undefined;
  let activeTab: MemoryTab = "overview";
  let filters: L2Filters = {};
  let loading = false;
  let busy = false;
  let errorMessage: string | undefined;
  let hasLoaded = false;

  const controller: MemoryViewController = {
    async show() {
      if (hasLoaded) {
        render();
        return;
      }
      loading = true;
      render();
      try {
        model = new MemoryViewModel(await options.api.getSnapshot());
        hasLoaded = true;
        errorMessage = undefined;
      } catch {
        errorMessage = "Memory is unavailable right now. Chat is still available.";
      } finally {
        loading = false;
        render();
      }
    },
    async refresh() {
      if (busy) return;
      loading = true;
      render();
      try {
        model = new MemoryViewModel(await options.api.getSnapshot());
        hasLoaded = true;
        errorMessage = undefined;
      } catch {
        errorMessage = "Memory could not be refreshed. The previous view was kept.";
      } finally {
        loading = false;
        render();
      }
    },
    setTab(tab) {
      activeTab = tab;
      render();
    },
  };

  function render(): void {
    options.root.replaceChildren();
    options.root.className = "memory-view";
    const header = createElement("header", "memory-header");
    const title = createElement("h2", undefined, "Memory");
    header.append(title);
    const refresh = createButton("Refresh", "memory-refresh", () => void controller.refresh());
    refresh.disabled = loading || busy;
    refresh.title = "Refresh memory snapshot";
    header.append(refresh);
    options.root.append(header);

    const tabs = createElement("nav", "memory-tabs");
    tabs.setAttribute("aria-label", "Memory sections");
    for (const tab of TABS) {
      const button = createButton(tab.label, `memory-tab-${tab.id}`, () => controller.setTab(tab.id));
      button.setAttribute("aria-pressed", String(activeTab === tab.id));
      button.setAttribute("data-memory-tab", tab.id);
      tabs.append(button);
    }
    options.root.append(tabs);

    const status = createElement("p", "memory-status");
    status.setAttribute("role", "status");
    if (loading) status.textContent = "Loading memory...";
    else if (errorMessage) status.textContent = errorMessage;
    else if (!model) status.textContent = "Memory is unavailable.";
    if (status.textContent) options.root.append(status);

    const content = createElement("section", "memory-content");
    content.setAttribute("aria-label", `${activeTab} memory panel`);
    if (model && !loading) renderTab(content, model.snapshot);
    else content.append(createState("Memory content is not available.", Boolean(loading)));
    options.root.append(content);
  }

  function renderTab(content: HTMLElement, snapshot: MemorySnapshot): void {
    switch (activeTab) {
      case "overview":
        renderOverview(content, snapshot);
        return;
      case "profile":
        renderProfile(content, snapshot);
        return;
      case "events":
        renderEvents(content, snapshot);
        return;
      case "conflicts":
        renderConflicts(content, snapshot);
        return;
      case "reflections":
        renderReflections(content, snapshot);
        return;
      case "audit":
        renderAudit(content, snapshot);
        return;
      case "relations":
        renderRelations(content);
        return;
    }
  }

  function renderOverview(content: HTMLElement, snapshot: MemorySnapshot): void {
    const counts = getOverviewCounts(snapshot);
    content.append(createHeading("Overview"));
    const grid = createElement("div", "memory-summary-grid");
    for (const [label, value] of [
      ["L0 fields", counts.l0],
      ["L1 fields", counts.l1],
      ["L2 memories", counts.l2],
      ["Enabled", counts.enabled],
      ["Pinned", counts.pinned],
      ["Conflicts", counts.conflicts],
      ["Reflections", counts.reflections],
      ["Audit entries", counts.audit],
    ] as const) {
      const item = createElement("div", "memory-summary-item");
      item.append(createText("span", "memory-summary-label", label));
      item.append(createText("strong", "memory-summary-value", String(value)));
      grid.append(item);
    }
    content.append(grid);
    const maintenance = createElement("p", "memory-muted");
    maintenance.textContent = snapshot.maintenance.running
      ? "Maintenance is running."
      : snapshot.maintenance.lastMaintenanceAt
        ? `Last maintenance: ${snapshot.maintenance.lastMaintenanceAt}`
        : "No maintenance run recorded.";
    content.append(maintenance);
  }

  function renderProfile(content: HTMLElement, snapshot: MemorySnapshot): void {
    content.append(createHeading("Profile"));
    for (const layer of ["L0", "L1"] as const) {
      const section = createElement("section", "memory-section");
      section.append(createText("h3", undefined, layer));
      for (const field of PROFILE_FIELDS.filter((item) => item.layer === layer)) {
        const row = createElement("div", "memory-profile-row");
        row.append(createText("label", "memory-field-label", field.label));
        const value = getProfileValue(snapshot, field);
        const input = document.createElement(field.array ? "textarea" : "input") as HTMLInputElement;
        input.className = "memory-field-input";
        input.setAttribute("data-memory-field", field.field);
        input.setAttribute("aria-label", field.label);
        input.value = field.array ? (value as string[]).join("\n") : String(value ?? "");
        if (field.array) input.setAttribute("rows", "2");
        row.append(input);
        const save = createButton("Save", `save-profile-${field.field}`, () => void saveProfile(field, input.value));
        save.disabled = busy;
        save.setAttribute("data-action", `save-profile-${field.field}`);
        row.append(save);
        const clear = createButton("Clear", `clear-profile-${layer}-${field.field}`, () => void deleteProfileField(field));
        clear.disabled = busy;
        clear.setAttribute("data-action", `clear-profile-${layer}-${field.field}`);
        clear.title = `Clear ${field.label}`;
        row.append(clear);
        section.append(row);
      }
      const clearLayer = createButton(`Clear ${layer}`, `clear-layer-${layer}`, () => void clearMemoryLayer(layer));
      clearLayer.disabled = busy;
      clearLayer.setAttribute("data-action", `clear-layer-${layer}`);
      clearLayer.title = `Clear all ${layer} memory`;
      section.append(clearLayer);
      content.append(section);
    }
  }

  function renderEvents(content: HTMLElement, snapshot: MemorySnapshot): void {
    content.append(createHeading("Events"));
    const controls = createElement("div", "memory-filter-row");
    const search = document.createElement("input") as HTMLInputElement;
    search.type = "search";
    search.placeholder = "Search memory";
    search.setAttribute("aria-label", "Search memory");
    search.value = filters.query ?? "";
    search.addEventListener("input", () => {
      filters = { ...filters, query: search.value };
      render();
    });
    controls.append(search);
    const status = createSelect("Status", L2_STATUSES, filters.status ?? "all", (value) => {
      filters = { ...filters, status: value as L2Filters["status"] };
      render();
    });
    controls.append(status);
    const enabled = createSelect("Enabled", ["all", "enabled", "disabled"], filters.enabled ?? "all", (value) => {
      filters = { ...filters, enabled: value as L2Filters["enabled"] };
      render();
    });
    controls.append(enabled);
    const pinned = createSelect("Pinned", ["all", "pinned", "unpinned"], filters.pinned ?? "all", (value) => {
      filters = { ...filters, pinned: value as L2Filters["pinned"] };
      render();
    });
    controls.append(pinned);
    content.append(controls);

    const rows = filterL2Rows(snapshot.l2, filters);
    const list = createElement("div", "memory-event-list");
    if (rows.length === 0) list.append(createState("No memories match these filters.", false));
    for (const row of rows) list.append(renderL2Row(row));
    content.append(list);
    const clearLayer = createButton("Clear L2", "clear-layer-L2", () => void clearMemoryLayer("L2"));
    clearLayer.disabled = busy;
    clearLayer.setAttribute("data-action", "clear-layer-L2");
    clearLayer.title = "Clear all L2 memories";
    content.append(clearLayer);
  }

  function renderL2Row(row: MemorySnapshot["l2"][number]): HTMLElement {
    const item = createElement("article", "memory-event-row");
    item.setAttribute("data-memory-row", row.id);
    const heading = createElement("div", "memory-event-heading");
    heading.append(createText("strong", undefined, row.id));
    heading.append(createText("span", "memory-badge", row.status));
    if (row.isPinned) heading.append(createText("span", "memory-badge memory-badge-pinned", "pinned"));
    item.append(heading);
    if (editingId === row.id) {
      const editor = document.createElement("textarea") as HTMLTextAreaElement;
      editor.className = "memory-edit-input";
      editor.value = row.content;
      editor.setAttribute("aria-label", `Edit memory ${row.id}`);
      item.append(editor);
      item.append(createButton("Save", `save-l2-${row.id}`, () => void saveL2(row.id, editor.value)));
      item.append(createButton("Cancel", `cancel-l2-${row.id}`, () => {
        editingId = undefined;
        render();
      }));
    } else {
      item.append(createText("p", "memory-event-content", row.content));
      const metadata = createText("p", "memory-muted", `Updated ${row.updatedAt} | Weight ${row.weight.toFixed(2)} | Accesses ${row.accessCount}`);
      item.append(metadata);
      const actions = createElement("div", "memory-actions");
      actions.append(actionButton("Edit", `edit-l2-${row.id}`, () => {
        editingId = row.id;
        render();
      }));
      actions.append(actionButton(row.isPinned ? "Unpin" : "Pin", `pin-l2-${row.id}`, () => void setPinned(row)));
      actions.append(actionButton(row.isEnabled ? "Disable" : "Enable", `enable-l2-${row.id}`, () => void setEnabled(row)));
      actions.append(actionButton("Delete", `delete-l2-${row.id}`, () => void deleteL2(row.id)));
      item.append(actions);
    }
    return item;
  }

  let editingId: string | undefined;

  function renderConflicts(content: HTMLElement, snapshot: MemorySnapshot): void {
    content.append(createHeading("Conflicts"));
    if (snapshot.conflicts.length === 0) {
      content.append(createState("No conflict records.", false));
      return;
    }
    const list = createElement("div", "memory-table");
    for (const conflict of snapshot.conflicts) {
      const row = createElement("div", "memory-table-row");
      row.append(createText("span", undefined, conflict.id));
      row.append(createText("span", undefined, `${conflict.status} | ${conflict.priority} | ${conflict.score.toFixed(2)}`));
      row.append(createText("span", undefined, `${conflict.sourceMemoryId} -> ${conflict.targetMemoryId}`));
      list.append(row);
    }
    content.append(list);
  }

  function renderReflections(content: HTMLElement, snapshot: MemorySnapshot): void {
    content.append(createHeading("Reflections"));
    if (snapshot.reflections.length === 0) {
      content.append(createState("No reflection records.", false));
      return;
    }
    const list = createElement("div", "memory-table");
    for (const reflection of snapshot.reflections) {
      const row = createElement("div", "memory-table-row");
      row.append(createText("span", undefined, reflection.id));
      row.append(createText("span", undefined, `${reflection.type} | accepted ${reflection.acceptedCount} | skipped ${reflection.skippedCount}`));
      row.append(createText("span", undefined, reflection.createdAt));
      list.append(row);
    }
    content.append(list);
  }

  function renderAudit(content: HTMLElement, snapshot: MemorySnapshot): void {
    content.append(createHeading("Audit"));
    if (snapshot.audit.length === 0) {
      content.append(createState("No audit entries.", false));
      return;
    }
    const list = createElement("div", "memory-table");
    for (const entry of snapshot.audit) {
      const row = createElement("div", "memory-table-row");
      row.append(createText("span", undefined, entry.operation));
      row.append(createText("span", undefined, `${entry.result} | ${entry.targetType} | ${entry.targetId ?? "none"}`));
      row.append(createText("span", undefined, entry.createdAt));
      list.append(row);
    }
    content.append(list);
  }

  function renderRelations(content: HTMLElement): void {
    content.append(createHeading("Relations"));
    content.append(createState("Relations are not available in this phase.", true));
  }

  async function saveProfile(field: ProfileField, rawValue: string): Promise<void> {
    const value = field.array ? rawValue.split("\n").map((item) => item.trim()).filter(Boolean) : rawValue.trim();
    if (field.array && value.length === 0 || !field.array && !value) {
      errorMessage = "Enter a value before saving.";
      render();
      return;
    }
    const input = { layer: field.layer, field: field.field, value } as UpdateProfileFieldInput;
    await runMutation(() => options.api.updateProfileField(input));
  }

  async function deleteProfileField(field: ProfileField): Promise<void> {
    if (!await confirm(`Clear ${field.label}?`)) return;
    const input = field.layer === "L0"
      ? { layer: "L0" as const, field: field.field as L0Field }
      : { layer: "L1" as const, field: field.field as L1Field };
    await runMutation(() => options.api.deleteProfileField(input));
  }

  async function saveL2(id: string, content: string): Promise<void> {
    if (!content.trim()) {
      errorMessage = "Enter a value before saving.";
      render();
      return;
    }
    await runMutation(() => options.api.updateL2({ id, content: content.trim() }));
    editingId = undefined;
  }

  async function deleteL2(id: string): Promise<void> {
    if (!await confirm("Delete this memory?")) return;
    await runMutation(() => options.api.deleteL2(id));
  }

  async function setPinned(row: MemorySnapshot["l2"][number]): Promise<void> {
    await runMutation(() => options.api.setL2Pinned({ id: row.id, pinned: !row.isPinned }));
  }

  async function setEnabled(row: MemorySnapshot["l2"][number]): Promise<void> {
    await runMutation(() => options.api.setL2Enabled({ id: row.id, enabled: !row.isEnabled }));
  }

  async function clearMemoryLayer(layer: MemoryLayer): Promise<void> {
    if (!await confirm(`Clear all ${layer} memory?`)) return;
    await runMutation(() => options.api.clearLayer(layer));
  }

  async function runMutation(operation: () => Promise<MemoryMutationResult>): Promise<void> {
    if (!model || busy) return;
    const previous = model.snapshot;
    busy = true;
    errorMessage = undefined;
    render();
    try {
      const result = await operation();
      const applied = model.applyMutation(result);
      if (!applied.ok) errorMessage = applied.error;
    } catch {
      model = new MemoryViewModel(previous);
      errorMessage = "The memory action failed. Your previous view was restored.";
    } finally {
      busy = false;
      render();
    }
  }

  function getProfileValue(snapshot: MemorySnapshot, field: ProfileField): string | string[] | undefined {
    const profile = field.layer === "L0" ? snapshot.l0 : snapshot.l1;
    return profile[field.field as keyof typeof profile] as string | string[] | undefined;
  }

  function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createText<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | undefined, text: string): HTMLElementTagNameMap[K] {
    return createElement(tag, className, text);
  }

  function createHeading(text: string): HTMLHeadingElement {
    return createText("h3", "memory-panel-heading", text);
  }

  function createState(text: string, disabled: boolean): HTMLElement {
    const state = createText("p", `memory-state${disabled ? " memory-state-disabled" : ""}`, text);
    state.setAttribute("aria-disabled", String(disabled));
    return state;
  }

  function createButton(text: string, _name: string, listener: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.textContent = text;
    button.addEventListener("click", listener);
    return button;
  }

  function actionButton(text: string, action: string, listener: () => void): HTMLButtonElement {
    const button = createButton(text, action, listener);
    button.setAttribute("data-action", action);
    button.setAttribute("aria-label", text);
    button.title = text;
    button.disabled = busy;
    return button;
  }

  function createSelect(label: string, values: readonly string[], selected: string, listener: (value: string) => void): HTMLElement {
    const wrapper = createElement("label", "memory-select-label");
    wrapper.append(createText("span", undefined, label));
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = value === selected;
      select.append(option);
    }
    select.addEventListener("change", () => listener(select.value));
    wrapper.append(select);
    return wrapper;
  }

  return controller;
}
