import type { SchedulerApi, SchedulerRunView, SchedulerTaskInput, SchedulerTaskView } from "../../shared/scheduler-api-types.js";
import { formatRunStatus, formatSchedule } from "./scheduler-view-model.js";

export interface SchedulerViewController { show(): Promise<void>; dispose(): void; }

export function mountSchedulerView(options: { root: HTMLElement; api: SchedulerApi; document?: Document }): SchedulerViewController {
  const document = options.document ?? window.document;
  const header = document.createElement("header"); header.className = "scheduler-header";
  const heading = document.createElement("h2"); heading.textContent = "Scheduled Tasks";
  const add = button(document, "Add Task", "secondary-button"); header.append(heading, add);
  const status = document.createElement("p"); status.className = "scheduler-status";
  const form = createForm(document, async (input) => { await options.api.createTask(input); form.hidden = true; await refresh(); });
  form.hidden = true;
  const tasks = document.createElement("div"); tasks.className = "scheduler-tasks";
  const history = document.createElement("div"); history.className = "scheduler-history";
  options.root.replaceChildren(header, status, form, tasks, history);

  async function refresh(): Promise<void> {
    status.textContent = "Loading...";
    try {
      const snapshot = await options.api.listTasks();
      renderTasks(snapshot.tasks);
      const runs = await options.api.listRuns();
      renderRuns(runs);
      status.textContent = `${snapshot.tasks.length} tasks | ${runs.length} runs`;
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  }

  function renderTasks(values: SchedulerTaskView[]): void {
    const rows = values.map((task) => {
      const row = document.createElement("section"); row.className = "scheduler-task-row";
      const main = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = task.name;
      const metadata = document.createElement("p"); metadata.className = "scheduler-metadata";
      metadata.textContent = `${formatSchedule(task.schedule)} | ${task.timezone} | Next: ${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "not scheduled"}`;
      const prompt = document.createElement("p"); prompt.textContent = task.prompt;
      main.append(title, metadata, prompt);
      const actions = document.createElement("div"); actions.className = "scheduler-actions";
      const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = task.enabled; enabled.title = "Enable task";
      enabled.addEventListener("change", async () => { await options.api.setEnabled(task.id, enabled.checked); await refresh(); });
      const run = button(document, "Run Now", "secondary-button"); run.disabled = !task.enabled;
      run.addEventListener("click", async () => { status.textContent = "Queued..."; await options.api.runNow(task.id); await refresh(); });
      const remove = button(document, "Delete", "secondary-button danger-button");
      remove.addEventListener("click", async () => { await options.api.removeTask(task.id); await refresh(); });
      actions.append(enabled, run, remove); row.append(main, actions); return row;
    });
    if (!rows.length) { const empty = document.createElement("p"); empty.textContent = "No scheduled tasks."; rows.push(empty); }
    tasks.replaceChildren(...rows);
  }

  function renderRuns(values: SchedulerRunView[]): void {
    const title = document.createElement("h3"); title.textContent = "Run History";
    const rows = values.slice(0, 50).map((run) => {
      const row = document.createElement("details"); row.className = "scheduler-run-row";
      const summary = document.createElement("summary"); summary.textContent = `${formatRunStatus(run.status)} | ${run.taskId} | ${new Date(run.scheduledFor).toLocaleString()}`;
      const body = document.createElement("pre");
      body.textContent = run.reply ?? run.errorCode ?? (run.status === "running" ? "Running..." : "No reply");
      const tools = document.createElement("p"); tools.textContent = run.toolCalls.length ? `Tools: ${run.toolCalls.map((call) => `${call.toolId} (${call.status})`).join(", ")}` : "No tool calls";
      row.append(summary, body, tools); return row;
    });
    history.replaceChildren(title, ...rows);
  }

  add.addEventListener("click", () => { form.hidden = !form.hidden; });
  const unsubscribe = options.api.onChanged(() => { void refresh(); });
  return { show: refresh, dispose: unsubscribe };
}

function createForm(document: Document, save: (input: SchedulerTaskInput) => Promise<void>): HTMLElement {
  const form = document.createElement("section"); form.className = "scheduler-form";
  const name = input(document, "Task name"); const prompt = document.createElement("textarea"); prompt.placeholder = "What should the agent do?";
  const kind = select(document, [["once", "Once"], ["interval", "Interval"], ["cron", "Cron"]]);
  const value = input(document, "Date/time, interval number, or cron expression"); value.type = "datetime-local";
  const unit = select(document, [["minutes", "Minutes"], ["hours", "Hours"], ["days", "Days"]]);
  const timezone = input(document, "Timezone"); timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  const missed = select(document, [["run-once", "Run once after startup"], ["skip", "Skip missed run"]]);
  kind.addEventListener("change", () => { value.type = kind.value === "once" ? "datetime-local" : kind.value === "interval" ? "number" : "text"; unit.hidden = kind.value !== "interval"; });
  unit.hidden = true;
  const submit = button(document, "Save Task", "secondary-button");
  submit.addEventListener("click", async () => {
    const schedule = kind.value === "once"
      ? { kind: "once" as const, runAt: new Date(value.value).toISOString() }
      : kind.value === "interval"
        ? { kind: "interval" as const, every: Number(value.value), unit: unit.value as "minutes" | "hours" | "days" }
        : { kind: "cron" as const, expression: value.value.trim() };
    await save({ name: name.value.trim(), prompt: prompt.value.trim(), schedule, timezone: timezone.value.trim(), missedRunPolicy: missed.value as "skip" | "run-once", enabled: true });
  });
  form.append(name, prompt, kind, value, unit, timezone, missed, submit); return form;
}

function input(document: Document, placeholder: string): HTMLInputElement { const el = document.createElement("input"); el.placeholder = placeholder; return el; }
function select(document: Document, options: [string, string][]): HTMLSelectElement { const el = document.createElement("select"); for (const [value, label] of options) { const option = document.createElement("option"); option.value = value; option.textContent = label; el.append(option); } return el; }
function button(document: Document, text: string, className: string): HTMLButtonElement { const el = document.createElement("button"); el.type = "button"; el.textContent = text; el.className = className; return el; }
