import { z } from "zod";
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
} from "./scheduled-task-types.js";
import { validateSchedule } from "./schedule-calculator.js";

const INVALID = "SCHEDULE_CONFIG_INVALID";
const idSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
const dateSchema = z.string().datetime({ offset: true });
const timezoneSchema = z.string().min(1).max(100).refine(isValidTimezone);

const onceSchema = z.object({
  kind: z.literal("once"),
  runAt: dateSchema,
}).strict();

const intervalSchema = z.object({
  kind: z.literal("interval"),
  every: z.number().int().positive(),
  unit: z.enum(["minutes", "hours", "days"]),
}).strict().refine((value) => {
  const milliseconds = value.every * ({ minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[value.unit]);
  return milliseconds >= 5 * 60_000 && milliseconds <= 365 * 86_400_000;
});

const cronSchema = z.object({
  kind: z.literal("cron"),
  expression: z.string().trim().min(1).max(200).refine((value) => value.split(/\s+/).length === 5),
}).strict();

const scheduleSchema = z.discriminatedUnion("kind", [onceSchema, intervalSchema, cronSchema]);

const taskInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1).max(10_000),
  schedule: scheduleSchema,
  timezone: timezoneSchema.default("Asia/Shanghai"),
  missedRunPolicy: z.enum(["skip", "run-once"]).default("run-once"),
  enabled: z.boolean().default(true),
}).strict();

const taskSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1).max(10_000),
  schedule: scheduleSchema,
  timezone: timezoneSchema,
  missedRunPolicy: z.enum(["skip", "run-once"]),
  enabled: z.boolean(),
  nextRunAt: dateSchema.optional(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).strict();

const toolCallSchema = z.object({
  toolId: z.string().min(1).max(128),
  args: z.record(z.string(), z.unknown()),
  status: z.enum(["succeeded", "failed", "blocked"]),
  startedAt: dateSchema,
  finishedAt: dateSchema.optional(),
  outputSummary: z.string().max(2_000).optional(),
  errorCode: z.string().max(100).optional(),
  approvalRequired: z.boolean().optional(),
}).strict();

const runSchema = z.object({
  id: z.string().min(1).max(100),
  taskId: idSchema,
  trigger: z.enum(["scheduled", "catch-up", "manual"]),
  status: z.enum([
    "queued", "running", "succeeded", "failed", "needs_attention",
    "skipped_overlap", "cancelled_shutdown",
  ]),
  scheduledFor: dateSchema,
  startedAt: dateSchema.optional(),
  finishedAt: dateSchema.optional(),
  reply: z.string().max(40_000).optional(),
  toolCalls: z.array(toolCallSchema).max(100),
  errorCode: z.string().max(100).optional(),
}).strict();

const tasksFileSchema = z.object({
  schemaVersion: z.literal(1),
  tasks: z.array(taskSchema).max(500),
}).strict();

const runsFileSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(runSchema).max(500),
}).strict();

export function parseScheduledTaskInput(value: unknown): ScheduledTaskInput {
  return validateParsedTask(parse(taskInputSchema, value));
}

export function parseScheduledTask(value: unknown): ScheduledTask {
  return validateParsedTask(parse(taskSchema, value));
}

export function parseScheduledRun(value: unknown): ScheduledTaskRun {
  return parse(runSchema, value);
}

export function parseScheduledTasksFile(value: unknown): ScheduledTask[] {
  const parsed = parse(tasksFileSchema, value).tasks.map(validateParsedTask);
  assertUnique(parsed.map((task) => task.id));
  return parsed;
}

export function parseScheduledRunsFile(value: unknown): ScheduledTaskRun[] {
  const parsed = parse(runsFileSchema, value).runs;
  assertUnique(parsed.map((run) => run.id));
  return parsed;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  assertPlainRecord(value);
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(INVALID);
  return result.data;
}

function assertUnique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error(INVALID);
}

function assertPlainRecord(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(INVALID);
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validateParsedTask<T extends ScheduledTaskInput>(task: T): T {
  try {
    validateSchedule(task.schedule, task.timezone);
    return task;
  } catch {
    throw new Error(INVALID);
  }
}
