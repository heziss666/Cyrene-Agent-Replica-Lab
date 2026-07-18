import { CronExpressionParser } from "cron-parser";
import type { ScheduledTask, TaskSchedule } from "./scheduled-task-types.js";

const INVALID = "SCHEDULE_TIME_INVALID";
const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

export function validateSchedule(schedule: TaskSchedule, timezone: string): void {
  assertTimezone(timezone);
  if (schedule.kind === "once") {
    if (!Number.isFinite(Date.parse(schedule.runAt))) throw new Error(INVALID);
    return;
  }
  if (schedule.kind === "interval") {
    const milliseconds = schedule.every * UNIT_MS[schedule.unit];
    if (!Number.isInteger(schedule.every)
      || milliseconds < 5 * 60_000
      || milliseconds > 365 * UNIT_MS.days) throw new Error(INVALID);
    return;
  }
  if (schedule.expression.trim().split(/\s+/).length !== 5) throw new Error(INVALID);
  try {
    CronExpressionParser.parse(schedule.expression, { currentDate: new Date(), tz: timezone });
  } catch {
    throw new Error(INVALID);
  }
}

export function nextOccurrence(
  schedule: TaskSchedule,
  timezone: string,
  after: Date,
): Date | undefined {
  validateSchedule(schedule, timezone);
  assertDate(after);
  if (schedule.kind === "once") {
    const result = new Date(schedule.runAt);
    return result.getTime() > after.getTime() ? result : undefined;
  }
  if (schedule.kind === "interval") {
    return new Date(after.getTime() + schedule.every * UNIT_MS[schedule.unit]);
  }
  try {
    return CronExpressionParser.parse(schedule.expression, {
      currentDate: after,
      tz: timezone,
    }).next().toDate();
  } catch {
    throw new Error(INVALID);
  }
}

export function resolveMissedTask(
  task: ScheduledTask,
  now: Date,
): { due: boolean; nextRunAt?: string; disable: boolean } {
  assertDate(now);
  const scheduled = task.nextRunAt
    ? new Date(task.nextRunAt)
    : nextOccurrence(task.schedule, task.timezone, new Date(task.createdAt));
  if (!scheduled || !Number.isFinite(scheduled.getTime())) {
    return { due: false, disable: task.schedule.kind === "once" };
  }
  if (scheduled.getTime() > now.getTime()) {
    return { due: false, nextRunAt: scheduled.toISOString(), disable: false };
  }
  const disable = task.schedule.kind === "once";
  const future = disable ? undefined : futureOccurrence(task.schedule, task.timezone, scheduled, now);
  return {
    due: task.missedRunPolicy === "run-once",
    ...(future ? { nextRunAt: future.toISOString() } : {}),
    disable,
  };
}

function futureOccurrence(
  schedule: TaskSchedule,
  timezone: string,
  scheduled: Date,
  now: Date,
): Date | undefined {
  if (schedule.kind === "cron") return nextOccurrence(schedule, timezone, now);
  if (schedule.kind === "interval") {
    const step = schedule.every * UNIT_MS[schedule.unit];
    const elapsed = Math.max(0, now.getTime() - scheduled.getTime());
    return new Date(scheduled.getTime() + (Math.floor(elapsed / step) + 1) * step);
  }
  return undefined;
}

function assertDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(INVALID);
}

function assertTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error(INVALID);
  }
}
