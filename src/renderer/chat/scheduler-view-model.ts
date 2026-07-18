import type { SchedulerRunView, SchedulerTaskSchedule } from "../../shared/scheduler-api-types.js";

export function formatSchedule(schedule: SchedulerTaskSchedule): string {
  if (schedule.kind === "once") return `Once: ${new Date(schedule.runAt).toLocaleString()}`;
  if (schedule.kind === "interval") return `Every ${schedule.every} ${schedule.unit}`;
  return `Cron: ${schedule.expression}`;
}

export function formatRunStatus(status: SchedulerRunView["status"]): string {
  const text = status.replaceAll("_", " ");
  return text[0]!.toUpperCase() + text.slice(1);
}
