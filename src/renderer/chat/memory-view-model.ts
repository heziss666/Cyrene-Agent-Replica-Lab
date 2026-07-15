import type {
  MemoryMutationResult,
  MemorySnapshot,
  MemoryL2Row,
} from "../../shared/memory-api-types.js";
import type { L0Field, L1Field } from "../../main/memory/memory-types.js";

export type MemoryTab =
  | "overview"
  | "profile"
  | "events"
  | "conflicts"
  | "reflections"
  | "audit"
  | "relations";

export type MemorySortKey = "updatedAt" | "weight" | "accessCount" | "status";
export type MemoryStatusFilter = "all" | MemoryL2Row["status"];
export type MemoryEnabledFilter = "all" | "enabled" | "disabled";
export type MemoryPinnedFilter = "all" | "pinned" | "unpinned";

export interface L2Filters {
  query?: string;
  status?: MemoryStatusFilter;
  enabled?: MemoryEnabledFilter;
  pinned?: MemoryPinnedFilter;
  sort?: MemorySortKey;
}

export interface MemoryOverviewCounts {
  l0: number;
  l1: number;
  l2: number;
  enabled: number;
  pinned: number;
  conflicts: number;
  reflections: number;
  audit: number;
}

const STATUS_ORDER: Record<MemoryL2Row["status"], number> = {
  active: 0,
  aging: 1,
  archived: 2,
  superseded: 3,
  merged: 4,
};

export function filterL2Rows(rows: readonly MemoryL2Row[], filters: L2Filters = {}): MemoryL2Row[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  const status = filters.status ?? "all";
  const enabled = filters.enabled ?? "all";
  const pinned = filters.pinned ?? "all";
  const filtered = rows.filter((row) => {
    if (query && !row.content.toLocaleLowerCase().includes(query)) return false;
    if (status !== "all" && row.status !== status) return false;
    if (enabled === "enabled" && !row.isEnabled) return false;
    if (enabled === "disabled" && row.isEnabled) return false;
    if (pinned === "pinned" && !row.isPinned) return false;
    if (pinned === "unpinned" && row.isPinned) return false;
    return true;
  });

  return sortL2Rows(filtered, filters.sort ?? "updatedAt");
}

export function sortL2Rows(rows: readonly MemoryL2Row[], sort: MemorySortKey): MemoryL2Row[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const comparison = compareRows(left.row, right.row, sort);
      return comparison || left.index - right.index;
    })
    .map(({ row }) => row);
}

function compareRows(left: MemoryL2Row, right: MemoryL2Row, sort: MemorySortKey): number {
  if (sort === "status") return STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  if (sort === "weight") return right.weight - left.weight;
  if (sort === "accessCount") return right.accessCount - left.accessCount;
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function getOverviewCounts(snapshot: MemorySnapshot): MemoryOverviewCounts {
  return {
    l0: countProfileFields(snapshot.l0),
    l1: countProfileFields(snapshot.l1),
    l2: snapshot.l2.length,
    enabled: snapshot.l2.filter((row) => row.isEnabled).length,
    pinned: snapshot.l2.filter((row) => row.isPinned).length,
    conflicts: snapshot.conflicts.length,
    reflections: snapshot.reflections.length,
    audit: snapshot.audit.length,
  };
}

function countProfileFields(profile: object): number {
  return Object.keys(profile).filter((key) => key !== "updatedAt" && key !== "fieldMetadata").length;
}

export function validateProfileValue(
  _layer: "L0" | "L1",
  _field: L0Field | L1Field,
  value: unknown,
): string | undefined {
  if (typeof value === "string") {
    return value.trim() ? undefined : "Enter a value before saving.";
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())) {
    return undefined;
  }
  return "Enter a value before saving.";
}

export function mapMutationError(result: Extract<MemoryMutationResult, { ok: false }>): string {
  switch (result.code) {
    case "invalid_content":
      return "This memory could not be saved because the content was rejected.";
    case "not_found":
      return "This memory changed elsewhere. Refresh and try again.";
    case "invalid_state":
      return "This memory is not available for that action.";
  }
}

export class MemoryViewModel {
  private currentSnapshot: MemorySnapshot;

  constructor(snapshot: MemorySnapshot) {
    this.currentSnapshot = snapshot;
  }

  get snapshot(): MemorySnapshot {
    return this.currentSnapshot;
  }

  applyMutation(result: MemoryMutationResult): { ok: true } | { ok: false; error: string } {
    if (!result.ok) return { ok: false, error: mapMutationError(result) };
    this.currentSnapshot = result.snapshot;
    return { ok: true };
  }
}
