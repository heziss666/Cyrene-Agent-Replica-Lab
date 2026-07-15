import type { L2MemoryV2 } from "./memory-types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const AGING_WEIGHT_THRESHOLD = 0.35;
const ARCHIVE_WEIGHT_THRESHOLD = 0.15;
const ARCHIVE_INACTIVITY_DAYS = 30;
const REACTIVATION_WEIGHT_THRESHOLD = 0.4;
const REINFORCEMENT_AMOUNT = 0.05;

export function calculateDecayedMemory(
  memory: L2MemoryV2,
  elapsedDays: number,
  now: Date,
): L2MemoryV2 {
  if (memory.status === "archived"
    || memory.status === "superseded"
    || memory.status === "merged"
    || elapsedDays <= 0) {
    return memory;
  }

  if (memory.isPinned) {
    return memory.weight === 1 ? memory : { ...memory, weight: 1 };
  }

  const nextWeight = roundWeight(
    memory.weight * Math.pow(0.5, elapsedDays / halfLifeDays(memory)),
  );
  const inactiveDays = (now.getTime() - Date.parse(memory.lastAccessedAt)) / DAY_MS;
  let status: L2MemoryV2["status"] = memory.status;
  if (memory.status === "aging"
    && nextWeight < ARCHIVE_WEIGHT_THRESHOLD
    && inactiveDays >= ARCHIVE_INACTIVITY_DAYS) {
    status = "archived";
  } else if (nextWeight < AGING_WEIGHT_THRESHOLD) {
    status = "aging";
  }

  return { ...memory, weight: nextWeight, status };
}

export function reinforceMemory(memory: L2MemoryV2, now: Date): L2MemoryV2 {
  const weight = memory.isPinned
    ? 1
    : roundWeight(Math.min(1, memory.weight + REINFORCEMENT_AMOUNT));
  const status = memory.status === "aging" && weight >= REACTIVATION_WEIGHT_THRESHOLD
    ? "active"
    : memory.status;
  return {
    ...memory,
    accessCount: memory.accessCount + 1,
    lastAccessedAt: now.toISOString(),
    weight,
    status,
  };
}

function halfLifeDays(memory: L2MemoryV2): number {
  if (memory.isSummary) return 180;
  return memory.importance === "high" ? 90 : 45;
}

function roundWeight(weight: number): number {
  return Math.round(weight * 1_000_000) / 1_000_000;
}
