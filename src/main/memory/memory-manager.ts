import { randomUUID } from "node:crypto";
import type { MemoryStore } from "./memory-store.js";
import type {
  L0Field,
  L0Profile,
  L1Field,
  L1Profile,
  MemoryFile,
  MemoryCandidate,
  MemoryWriteSummary,
} from "./memory-types.js";

const l0Fields = new Set<L0Field>([
  "preferredName",
  "occupation",
  "longTermInterests",
  "language",
  "permanentNotes",
]);
const l1Fields = new Set<L1Field>([
  "currentProject",
  "recentGoals",
  "recentPreferences",
]);
const importanceValues = new Set(["low", "medium", "high"]);

const sensitivePatterns = [
  /\bsk-[a-z0-9_-]+/iu,
  /\bapi[\s_-]*key\b/iu,
  /\baccess[\s_-]*token\b/iu,
  /\bpassword\b/iu,
  /\b(?:bank[\s_-]*card|card[\s_-]*number|payment[\s_-]*account)\b/iu,
  /\b(?:id(?:entity)?[\s_-]*(?:card|document)|passport|social[\s_-]*security)\b/iu,
  /\b(?:home|residential|exact)[\s_-]*address\b/iu,
  /密码|验证码|银行卡|支付账户|身份证|护照|家庭住址|家庭地址|详细地址|精确地址/u,
  /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/u,
];

interface ValidatedCandidateBase {
  content: string;
  confidence: number;
  importance: MemoryCandidate["importance"];
  evidenceQuote: string;
}

type ValidatedCandidate =
  | (ValidatedCandidateBase & { layer: "L0"; field: L0Field })
  | (ValidatedCandidateBase & { layer: "L1"; field: L1Field })
  | (ValidatedCandidateBase & {
    layer: "L2";
    importance: "medium" | "high";
  });

export interface MemoryManager {
  writeCandidates(input: {
    userMessage: string;
    candidates: MemoryCandidate[];
  }): Promise<MemoryWriteSummary>;
}

export function createMemoryManager(options: {
  store: MemoryStore;
  now?: () => Date;
  idFactory?: () => string;
}): MemoryManager {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  return {
    async writeCandidates(input) {
      const writes: string[] = [];
      const timestamp = now().toISOString();

      await options.store.update((draft) => {
        for (const untrustedCandidate of input.candidates) {
          const validated = validateCandidate(untrustedCandidate, input.userMessage);
          if (!validated) continue;

          const write = persistCandidate(draft, validated, timestamp, idFactory);
          if (write) writes.push(write);
        }
      });

      return {
        candidateCount: input.candidates.length,
        writtenCount: writes.length,
        skippedCount: input.candidates.length - writes.length,
        writes,
      };
    },
  };
}

function validateCandidate(
  value: unknown,
  userMessage: string,
): ValidatedCandidate | undefined {
  if (!isRecord(value)
    || typeof value.layer !== "string"
    || typeof value.content !== "string"
    || typeof value.confidence !== "number"
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || typeof value.importance !== "string"
    || !importanceValues.has(value.importance)
    || typeof value.evidenceQuote !== "string"
    || value.evidenceQuote.trim().length === 0
    || !userMessage.includes(value.evidenceQuote)) {
    return undefined;
  }

  const content = normalizeContent(value.content);
  if (content.length === 0
    || containsSensitiveData(content)
    || containsSensitiveData(value.evidenceQuote)) {
    return undefined;
  }

  const base = {
    content,
    confidence: value.confidence,
    importance: value.importance as MemoryCandidate["importance"],
    evidenceQuote: value.evidenceQuote,
  };

  if (value.layer === "L0"
    && typeof value.field === "string"
    && l0Fields.has(value.field as L0Field)
    && value.confidence >= 0.90) {
    return { ...base, layer: "L0", field: value.field as L0Field };
  }
  if (value.layer === "L1"
    && typeof value.field === "string"
    && l1Fields.has(value.field as L1Field)
    && value.confidence >= 0.80) {
    return { ...base, layer: "L1", field: value.field as L1Field };
  }
  if (value.layer === "L2"
    && value.field === undefined
    && value.confidence >= 0.80
    && (value.importance === "medium" || value.importance === "high")) {
    return {
      ...base,
      layer: "L2",
      importance: value.importance,
    };
  }
  return undefined;
}

function persistCandidate(
  draft: MemoryFile,
  candidate: ValidatedCandidate,
  timestamp: string,
  idFactory: () => string,
): string | undefined {
  if (candidate.layer === "L0") {
    if (!writeL0(draft.l0, candidate.field, candidate.content)) return undefined;
    draft.l0.updatedAt = timestamp;
    return `L0.${candidate.field}`;
  }

  if (candidate.layer === "L1") {
    if (!writeL1(draft.l1, candidate.field, candidate.content)) return undefined;
    draft.l1.updatedAt = timestamp;
    return `L1.${candidate.field}`;
  }

  const contentKey = dedupeKey(candidate.content);
  if (draft.l2.some((memory) => dedupeKey(memory.content) === contentKey)) {
    return undefined;
  }
  draft.l2.push({
    id: idFactory(),
    content: candidate.content,
    confidence: candidate.confidence,
    importance: candidate.importance,
    evidence: {
      userQuote: candidate.evidenceQuote,
      capturedAt: timestamp,
    },
    createdAt: timestamp,
    status: "active",
  });
  return "L2";
}

function writeL0(profile: L0Profile, field: L0Field, content: string): boolean {
  switch (field) {
    case "preferredName":
    case "occupation":
    case "language":
      return replaceSingleValue(profile, field, content);
    case "longTermInterests":
    case "permanentNotes":
      return appendUnique(profile[field], content);
  }
}

function writeL1(profile: L1Profile, field: L1Field, content: string): boolean {
  switch (field) {
    case "currentProject":
      return replaceSingleValue(profile, field, content);
    case "recentGoals":
    case "recentPreferences":
      return appendUnique(profile[field], content);
  }
}

function replaceSingleValue<
  Profile extends object,
  Field extends keyof Profile,
>(profile: Profile, field: Field, content: string): boolean {
  const current = profile[field];
  if (typeof current === "string" && dedupeKey(current) === dedupeKey(content)) {
    return false;
  }
  profile[field] = content as Profile[Field];
  return true;
}

function appendUnique(values: string[], content: string): boolean {
  const contentKey = dedupeKey(content);
  if (values.some((value) => dedupeKey(value) === contentKey)) return false;
  values.push(content);
  return true;
}

function normalizeContent(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function dedupeKey(value: string): string {
  return normalizeContent(value).toLowerCase();
}

function containsSensitiveData(value: string): boolean {
  const normalized = value.normalize("NFKC");
  return sensitivePatterns.some((pattern) => pattern.test(normalized));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
