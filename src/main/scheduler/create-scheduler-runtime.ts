import { join } from "node:path";
import type { AgentEvent } from "../agent/agent-events.js";
import { createScheduledRunStore } from "./scheduled-run-store.js";
import type { ScheduledAgentRunner } from "./scheduled-agent-runner.js";
import { createScheduledTaskQueue } from "./scheduled-task-queue.js";
import { createScheduledTaskStore } from "./scheduled-task-store.js";
import type { ScheduledTask, ScheduledTaskRun } from "./scheduled-task-types.js";
import { createTaskScheduler, type TaskScheduler } from "./task-scheduler.js";

export function createSchedulerRuntime(options: {
  dataDir: string;
  runner: ScheduledAgentRunner;
  onChanged?: () => void;
  onRunFinished?: (run: ScheduledTaskRun, task: ScheduledTask) => void;
  onEvent?: (event: AgentEvent) => void;
}): TaskScheduler {
  return createTaskScheduler({
    taskStore: createScheduledTaskStore(join(options.dataDir, "scheduled-tasks.json")),
    runStore: createScheduledRunStore(join(options.dataDir, "scheduled-runs.json")),
    queue: createScheduledTaskQueue(),
    runner: options.runner,
    onChanged: options.onChanged,
    onRunFinished: options.onRunFinished,
    onEvent: options.onEvent,
  });
}
