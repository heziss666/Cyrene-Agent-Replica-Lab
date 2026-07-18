import type { RunsApi } from "../../shared/run-api-types.js";
import { createRunsViewModel } from "./runs-view-model.js";

export function mountRunsView(options: { root: HTMLElement; api: RunsApi; document?: Document }) {
  const document = options.document ?? window.document;
  const model = createRunsViewModel();

  async function select(runId: string): Promise<void> {
    model.setSelected(await options.api.get(runId));
    render();
  }

  function button(label: string, action: () => void | Promise<void>, title = label): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.title = title;
    element.addEventListener("click", () => void action());
    return element;
  }

  function render(): void {
    const state = model.snapshot();
    const header = document.createElement("header");
    header.className = "runs-header";
    const title = document.createElement("h2");
    title.textContent = "Agent Runs";
    const actions = document.createElement("div");
    actions.className = "runs-actions";
    actions.append(button("Clear", async () => { await options.api.clear(); await refresh(); }, "Clear run history"));
    header.append(title, actions);

    const filters = document.createElement("div");
    filters.className = "runs-filters";
    const query = document.createElement("input");
    query.type = "search";
    query.placeholder = "Search runs";
    query.value = state.filters.query;
    query.addEventListener("input", () => { model.setFilters({ query: query.value }); render(); });
    const source = selectControl(["all", "chat", "scheduler"], state.filters.source, (value) => {
      model.setFilters({ source: value as "all" | "chat" | "scheduler" }); render();
    });
    const status = selectControl(["all", "queued", "running", "succeeded", "failed", "cancelled"], state.filters.status, (value) => {
      model.setFilters({ status: value as typeof state.filters.status }); render();
    });
    filters.append(query, source, status);

    const body = document.createElement("div");
    body.className = "runs-body";
    const list = document.createElement("div");
    list.className = "runs-list";
    for (const run of state.visible) {
      const row = button("", () => select(run.runId), `Open ${run.runId}`);
      row.className = `run-row${state.selected?.runId === run.runId ? " is-active" : ""}`;
      const identity = document.createElement("strong");
      identity.textContent = run.runId;
      const meta = document.createElement("span");
      meta.textContent = `${run.source} | ${run.status} | ${new Date(run.queuedAt).toLocaleString()}`;
      row.append(identity, meta);
      list.append(row);
    }
    if (state.visible.length === 0) {
      const empty = document.createElement("p"); empty.className = "runs-empty"; empty.textContent = "No runs found"; list.append(empty);
    }
    body.append(list, renderDetail(state.selected));
    options.root.replaceChildren(header, filters, body);
  }

  function renderDetail(run: ReturnType<typeof model.snapshot>["selected"]): HTMLElement {
    const detail = document.createElement("section");
    detail.className = "run-detail";
    if (!run) { detail.textContent = "Select a run to inspect its trace."; return detail; }
    const heading = document.createElement("h3"); heading.textContent = run.runId;
    const summary = document.createElement("p");
    summary.textContent = `${run.source} | ${run.status} | ${run.usage.totalTokens} tokens (${run.usage.source})`;
    const actions = document.createElement("div"); actions.className = "run-detail-actions";
    if (run.status === "queued" || run.status === "running") {
      actions.append(button("Stop", async () => { await options.api.cancel(run.runId); await refresh(run.runId); }));
    }
    actions.append(
      button("Export", async () => { await options.api.export(run.runId); }),
      button("Delete", async () => { await options.api.remove(run.runId); model.setSelected(undefined); await refresh(); }),
    );
    detail.append(heading, summary, actions);
    if (run.error) {
      const error = document.createElement("p"); error.className = "run-error";
      error.textContent = `${run.error.code}: ${run.error.safeMessage}`; detail.append(error);
    }
    const trace = document.createElement("ol"); trace.className = "run-trace";
    for (const event of run.events) {
      const item = document.createElement("li");
      item.textContent = `#${event.sequence} ${event.type}${event.data === undefined ? "" : ` ${JSON.stringify(event.data)}`}`;
      trace.append(item);
    }
    detail.append(trace);
    return detail;
  }

  function selectControl(values: string[], selected: string, onChange: (value: string) => void): HTMLSelectElement {
    const element = document.createElement("select");
    for (const value of values) { const option = document.createElement("option"); option.value = value; option.textContent = value; element.append(option); }
    element.value = selected;
    element.addEventListener("change", () => onChange(element.value));
    return element;
  }

  async function refresh(selectedRunId?: string): Promise<void> {
    model.setRuns(await options.api.list());
    if (selectedRunId) model.setSelected(await options.api.get(selectedRunId));
    render();
  }

  const unsubscribe = options.api.onChanged(() => { void refresh(model.snapshot().selected?.runId); });
  return { show: refresh, refresh, dispose: unsubscribe };
}
