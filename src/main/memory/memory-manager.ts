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
import { initialMemoryWeight } from "./memory-types.js";

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

const sensitiveCompactLabels = [
  "apikey",
  "accesstoken",
  "password",
  "bankcard",
  "cardnumber",
  "paymentaccount",
  "idcard",
  "identitycard",
  "identitydocument",
  "passport",
  "socialsecurity",
  "homeaddress",
  "residentialaddress",
  "exactaddress",
  "\u5bc6\u7801",
  "\u9a8c\u8bc1\u7801",
  "\u94f6\u884c\u5361",
  "\u652f\u4ed8\u8d26\u6237",
  "\u8eab\u4efd\u8bc1",
  "\u62a4\u7167",
  "\u5bb6\u5ead\u4f4f\u5740",
  "\u5bb6\u5ead\u5730\u5740",
  "\u8be6\u7ec6\u5730\u5740",
  "\u7cbe\u786e\u5730\u5740",
];
const secretLikePattern = /(?<![\p{L}\p{N}])sk[\s\p{P}\u2212]+[\p{L}\p{N}]/iu;
const bankCardLikePattern = /(?:\p{Nd}[\s\p{P}\u2212]*){12,18}\p{Nd}/u;
const socialSecurityNumberLikePattern = /(?<!\p{N})\p{N}{3}[\s-]\p{N}{2}[\s-]\p{N}{4}(?!\p{N})/u;
const jwtLikePattern = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_-])/u;
const githubPatLikePattern = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/iu;
const awsAccessKeyLikePattern = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u;
const exactAddressPattern = /\b(?:(?:my|home|residential|mailing|exact)\s+address|address\s*(?::|is\b|at\b))|(?:\u6211\u7684)?(?:\u5bb6\u5ead|\u5c45\u4f4f|\u90ae\u5bc4|\u8be6\u7ec6|\u7cbe\u786e)?\u5730\u5740(?:\u662f|\u4e3a|[\uff1a:])/iu;
const medicalPrivacyPattern = /\b(?:medical|health|diagnos(?:is|ed)|disease|medication|allerg(?:y|ic)|doctor|hospital|therapy|patient|cancer|hiv|aids|diabetes|pregnan(?:t|cy)|mental\s+health)\b|\u533b\u7597|\u5065\u5eb7|\u8bca\u65ad|\u60a3\u6709|\u75be\u75c5|\u75c5\u53f2|\u7528\u836f|\u8fc7\u654f|\u533b\u751f|\u533b\u9662|\u6cbb\u7597|\u764c\u75c7|\u827e\u6ecb|\u7cd6\u5c3f\u75c5|\u6000\u5b55/u;
const legalPrivacyPattern = /\b(?:legal|lawsuit|litigation|attorney|lawyer|court\s+case|arrested|convicted|custody|divorce|criminal\s+charges?|charged\s+with|criminal\s+record|probation|bankruptcy)\b|\u6cd5\u5f8b|\u8bc9\u8bbc|\u5f8b\u5e08|\u6cd5\u9662|\u6848\u4ef6|\u88ab\u6355|\u5b9a\u7f6a|\u79bb\u5a5a|\u5211\u4e8b\u6307\u63a7|\u72af\u7f6a\u8bb0\u5f55|\u7f13\u5211|\u7834\u4ea7/u;
const negationPattern = /\b(?:not|no|never|without|neither|nor|cannot|can't|won't|don't|doesn't|didn't)\b|\u4e0d(?:\u662f|\u559c\u6b22|\u4f7f\u7528|\u60f3|\u8981|\u4f1a)|\u6ca1\u6709|\u4ece\u672a|\u5e76\u975e|\u4e0d\u4f1a|\u672a\u66fe|\u65e0\u610f/iu;
const explicitLongTermOptInPattern = /\b(?:please\s+)?(?:remember|save|store|keep)\b.{0,40}\b(?:this|that|it|for\s+future|in\s+(?:long[- ]term\s+)?memory|for\s+future\s+conversations)\b|\blong[- ]term\s+(?:remember|memory|storage)\b|\u8bf7?(?:\u957f\u671f)?(?:\u8bb0\u4f4f|\u4fdd\u5b58|\u8bb0\u4e0b)|\u957f\u671f\u8bb0\u5fc6/iu;

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
    || normalizeForInspection(value.evidenceQuote).length === 0
    || typeof value.reason !== "string"
    || !userMessage.includes(value.evidenceQuote)) {
    return undefined;
  }

  const content = normalizeContent(value.content);
  const privacyContext = candidatePrivacyContext(
    userMessage,
    value.evidenceQuote,
    content,
  );
  if (normalizeForInspection(content).length === 0
    || !isContentSupportedByEvidence(content, value.evidenceQuote)
    || containsNeverStorableData(privacyContext)
    || (containsConditionalPrivacy(privacyContext)
      && !hasScopedExplicitLongTermOptIn(userMessage, value.evidenceQuote))) {
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
  const memoryId = idFactory();
  const evidenceId = idFactory();
  draft.l2.push({
    id: memoryId,
    content: candidate.content,
    confidence: candidate.confidence,
    importance: candidate.importance,
    evidenceIds: [evidenceId],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: timestamp,
    accessCount: 0,
    weight: initialMemoryWeight(candidate.importance, candidate.confidence),
    isPinned: false,
    isEnabled: true,
    status: "active",
    syncStatus: "pending_sync",
    isSummary: false,
    sourceMemoryIds: [],
    sourceSnapshots: [],
    conflictWith: [],
  });
  draft.evidence.push({
    id: evidenceId,
    memoryId,
    quote: candidate.evidenceQuote,
    capturedAt: timestamp,
    source: "conversation",
    sourceMemoryIds: [],
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
  // Uppercasing uses built-in multi-character expansions such as ß -> SS.
  return normalizeContent(normalizeContent(value).toUpperCase());
}

function containsNeverStorableData(value: string): boolean {
  const normalized = normalizeForInspection(value);
  const compact = normalized.replace(/[\s\p{P}\u2212]+/gu, "").toLowerCase();
  return secretLikePattern.test(normalized)
    || bankCardLikePattern.test(normalized)
    || socialSecurityNumberLikePattern.test(normalized)
    || jwtLikePattern.test(normalized)
    || githubPatLikePattern.test(normalized)
    || awsAccessKeyLikePattern.test(normalized)
    || exactAddressPattern.test(normalized)
    || sensitiveCompactLabels.some((label) => compact.includes(label));
}

function containsConditionalPrivacy(value: string): boolean {
  const inspected = normalizeForInspection(value);
  return medicalPrivacyPattern.test(inspected) || legalPrivacyPattern.test(inspected);
}

function candidatePrivacyContext(
  userMessage: string,
  evidenceQuote: string,
  content: string,
): string {
  const contexts = [content, evidenceQuote];
  let quoteStart = userMessage.indexOf(evidenceQuote);
  while (quoteStart >= 0) {
    contexts.push(userMessage.slice(
      findStatementStart(userMessage, quoteStart),
      findStatementEnd(userMessage, quoteStart + evidenceQuote.length),
    ));
    quoteStart = userMessage.indexOf(evidenceQuote, quoteStart + 1);
  }
  return contexts.join(" ");
}

function isContentSupportedByEvidence(content: string, evidenceQuote: string): boolean {
  const normalizedContent = normalizeForBinding(content);
  const normalizedEvidence = normalizeForBinding(evidenceQuote);
  if (normalizedContent.length === 0
    || !normalizedEvidence.includes(normalizedContent)) {
    return false;
  }

  const inspectedEvidence = normalizeForInspection(evidenceQuote);
  return !negationPattern.test(inspectedEvidence)
    || normalizedContent === normalizedEvidence;
}

function normalizeForBinding(value: string): string {
  return normalizeForInspection(value)
    .toLowerCase()
    .replace(/[\s\p{P}\u2212]+/gu, "");
}

function hasScopedExplicitLongTermOptIn(
  userMessage: string,
  evidenceQuote: string,
): boolean {
  let quoteStart = userMessage.indexOf(evidenceQuote);
  while (quoteStart >= 0) {
    const statementStart = findStatementStart(userMessage, quoteStart);
    const statementEnd = findStatementEnd(
      userMessage,
      quoteStart + evidenceQuote.length,
    );
    const statement = normalizeForInspection(
      userMessage.slice(statementStart, statementEnd),
    );
    if (explicitLongTermOptInPattern.test(statement)) return true;
    quoteStart = userMessage.indexOf(evidenceQuote, quoteStart + 1);
  }
  return false;
}

function findStatementStart(value: string, before: number): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (isStatementBoundary(value[index])) return index + 1;
  }
  return 0;
}

function findStatementEnd(value: string, after: number): number {
  for (let index = after; index < value.length; index += 1) {
    if (isStatementBoundary(value[index])) return index;
  }
  return value.length;
}

function isStatementBoundary(value: string | undefined): boolean {
  return value !== undefined && ".!?;\n\r\u3002\uff01\uff1f\uff1b".includes(value);
}

function normalizeForInspection(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
