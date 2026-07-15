const MAX_NORMALIZED_CONTENT_LENGTH = 2_000;

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
const englishStreetAddressPattern = /(?<![\p{L}\p{N}])\p{Nd}{1,5}[a-z]?(?:-\p{Nd}{1,5}[a-z]?)?\s+(?:[a-z][a-z.'-]*\s+){0,4}(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|place|pl\.?|way|terrace|ter\.?|parkway|pkwy\.?|circle|cir\.?|highway|hwy\.?)\b/iu;
const poBoxAddressPattern = /\bp\.?\s*o\.?\s+box\s+\p{Nd}{1,8}\b/iu;
const chineseStreetAddressPattern = /(?:\p{Script=Han}{1,20})(?:\u5927\u9053|\u8def|\u8857|\u9053|\u5df7|\u5f04)(?:\p{Nd}{1,5}|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4e24\u3007\u96f6]{1,7})(?:\u53f7|\u5f04(?:\p{Nd}{1,5}|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4e24\u3007\u96f6]{1,7})\u53f7)/u;
const medicalPrivacyPattern = /\b(?:medical|health|diagnos(?:is|ed)|disease|medication|allerg(?:y|ic)|doctor|hospital|therapy|patient|cancer|hiv|aids|diabetes|pregnan(?:t|cy)|mental\s+health)\b|\u533b\u7597|\u5065\u5eb7|\u8bca\u65ad|\u60a3\u6709|\u75be\u75c5|\u75c5\u53f2|\u7528\u836f|\u8fc7\u654f|\u533b\u751f|\u533b\u9662|\u6cbb\u7597|\u764c\u75c7|\u827e\u6ecb|\u7cd6\u5c3f\u75c5|\u6000\u5b55/u;
const legalPrivacyPattern = /\b(?:legal|lawsuit|litigation|attorney|lawyer|court\s+case|arrested|convicted|custody|divorce|criminal\s+charges?|charged\s+with|criminal\s+record|probation|bankruptcy)\b|\u6cd5\u5f8b|\u8bc9\u8bbc|\u5f8b\u5e08|\u6cd5\u9662|\u6848\u4ef6|\u88ab\u6355|\u5b9a\u7f6a|\u79bb\u5a5a|\u5211\u4e8b\u6307\u63a7|\u72af\u7f6a\u8bb0\u5f55|\u7f13\u5211|\u7834\u4ea7/u;
const negationPattern = /\b(?:not|no|never|without|neither|nor|cannot|can't|won't|don't|doesn't|didn't)\b|\u4e0d(?:\u662f|\u559c\u6b22|\u4f7f\u7528|\u60f3|\u8981|\u4f1a)|\u6ca1\u6709|\u4ece\u672a|\u5e76\u975e|\u4e0d\u4f1a|\u672a\u66fe|\u65e0\u610f/iu;
const explicitLongTermOptInPattern = /\b(?:please\s+)?(?:remember|save|store|keep)\b.{0,40}\b(?:this|that|it|for\s+future|in\s+(?:long[- ]term\s+)?memory|for\s+future\s+conversations)\b|\blong[- ]term\s+(?:remember|memory|storage)\b|\u8bf7?(?:\u957f\u671f)?(?:\u8bb0\u4f4f|\u4fdd\u5b58|\u8bb0\u4e0b)|\u957f\u671f\u8bb0\u5fc6/iu;

export type MemoryContentPolicyResult =
  | { ok: true; content: string }
  | { ok: false; code: "empty" | "too_long" | "unsupported_evidence" | "forbidden_sensitive_data" | "privacy_opt_in_required" };

export function normalizeMemoryContent(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function validateModelMemoryContent(input: {
  userMessage: string;
  evidenceQuote: string;
  content: string;
}): MemoryContentPolicyResult {
  const content = normalizeMemoryContent(input.content);
  const basicResult = validateBasicContent(content);
  if (basicResult) return basicResult;

  if (normalizeForInspection(input.evidenceQuote).length === 0
    || !input.userMessage.includes(input.evidenceQuote)
    || !isContentSupportedByEvidence(content, input.evidenceQuote)) {
    return { ok: false, code: "unsupported_evidence" };
  }

  const privacyContext = candidatePrivacyContext(
    input.userMessage,
    input.evidenceQuote,
    content,
  );
  if (containsNeverStorableData(privacyContext)) {
    return { ok: false, code: "forbidden_sensitive_data" };
  }
  if (containsConditionalPrivacy(privacyContext)
    && !hasScopedExplicitLongTermOptIn(input.userMessage, input.evidenceQuote)) {
    return { ok: false, code: "privacy_opt_in_required" };
  }

  return { ok: true, content };
}

export function validateUserEditedMemoryContent(
  value: string,
): MemoryContentPolicyResult {
  const content = normalizeMemoryContent(value);
  const basicResult = validateBasicContent(content);
  if (basicResult) return basicResult;
  if (containsNeverStorableData(content)) {
    return { ok: false, code: "forbidden_sensitive_data" };
  }
  return { ok: true, content };
}

function validateBasicContent(content: string): MemoryContentPolicyResult | undefined {
  if (normalizeForInspection(content).length === 0) {
    return { ok: false, code: "empty" };
  }
  if (content.length > MAX_NORMALIZED_CONTENT_LENGTH) {
    return { ok: false, code: "too_long" };
  }
  return undefined;
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
    || englishStreetAddressPattern.test(normalized)
    || poBoxAddressPattern.test(normalized)
    || chineseStreetAddressPattern.test(normalized)
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
