export interface PossibleConflictCandidate {
  isCandidate: boolean;
  duplicate: boolean;
  sharedTopic: boolean;
  correctionIntent: boolean;
  preferenceEvolution: boolean;
  vagueTokenOnlyOverlap: boolean;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "be", "do", "does", "i", "in", "is", "it", "my", "no",
  "not", "now", "of", "the", "to", "use", "using", "with", "you",
]);
const VAGUE_WORDS = new Set(["prefer", "like", "dislike", "have", "want"]);
const CORRECTION_PATTERN = /\b(no longer|do not|don't|never|stopped|instead of|used to)\b/i;
const PREFERENCE_PATTERN = /\b(prefer|like|dislike|want)\b/i;
const EVOLUTION_PATTERN = /\b(now|previously|before|instead|changed|switch(?:ed)?|anymore)\b/i;
const CHINESE_TOPIC_STOP_WORDS = new Set([
  "\u4e0d\u518d", "\u4e0d\u559c\u6b22", "\u4e0d\u4f7f\u7528", "\u4ee5\u524d", "\u4e4b\u524d", "\u4f7f\u7528", "\u559c\u6b22", "\u504f\u597d", "\u60f3\u8981", "\u5e0c\u671b", "\u73b0\u5728", "\u5982\u4eca", "\u66f4\u559c\u6b22", "\u6539\u7528", "\u6539\u6210", "\u6362\u6210",
]);
const CHINESE_CORRECTION_PATTERN = /\u4e0d\u518d|\u4e0d\u4f7f\u7528|\u505c\u6b62\u4f7f\u7528|\u6539\u7528|\u6539\u6210|\u6362\u6210/u;
const CHINESE_PREFERENCE_PATTERN = /\u559c\u6b22|\u504f\u597d|\u60f3\u8981|\u5e0c\u671b/u;
const CHINESE_EVOLUTION_PATTERN = /\u73b0\u5728|\u5982\u4eca|\u4ee5\u524d|\u4e4b\u524d|\u4e0d\u518d|\u6539\u7528|\u6539\u6210|\u6362\u6210/u;

function normalize(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function topicTerms(value: string): Set<string> {
  const terms = new Set(
    normalize(value).match(/[a-z0-9]{2,}/g)?.filter((word) => !STOP_WORDS.has(word)) ?? [],
  );
  for (const run of normalize(value).match(/\p{Script=Han}+/gu) ?? []) {
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let start = 0; start <= run.length - size; start += 1) {
        const term = run.slice(start, start + size);
        if (!CHINESE_TOPIC_STOP_WORDS.has(term)) terms.add(term);
      }
    }
  }
  return terms;
}

export function findPossibleConflictCandidate(
  newContent: string,
  existingContent: string,
): PossibleConflictCandidate {
  const normalizedNew = normalize(newContent);
  const normalizedExisting = normalize(existingContent);
  if (normalizedNew === normalizedExisting) {
    return {
      isCandidate: false,
      duplicate: true,
      sharedTopic: false,
      correctionIntent: false,
      preferenceEvolution: false,
      vagueTokenOnlyOverlap: false,
    };
  }

  const newTopics = topicTerms(newContent);
  const existingTopics = topicTerms(existingContent);
  const sharedTerms = [...newTopics].filter((term) => existingTopics.has(term));
  const sharedTopic = sharedTerms.length > 0;
  const correctionIntent = CORRECTION_PATTERN.test(newContent)
    || CORRECTION_PATTERN.test(existingContent)
    || CHINESE_CORRECTION_PATTERN.test(newContent)
    || CHINESE_CORRECTION_PATTERN.test(existingContent);
  const preferenceEvolution = (PREFERENCE_PATTERN.test(newContent)
    || PREFERENCE_PATTERN.test(existingContent)
    || CHINESE_PREFERENCE_PATTERN.test(newContent)
    || CHINESE_PREFERENCE_PATTERN.test(existingContent))
    && (EVOLUTION_PATTERN.test(newContent)
      || EVOLUTION_PATTERN.test(existingContent)
      || CHINESE_EVOLUTION_PATTERN.test(newContent)
      || CHINESE_EVOLUTION_PATTERN.test(existingContent));
  const vagueTokenOnlyOverlap = sharedTopic && sharedTerms.every((term) => VAGUE_WORDS.has(term));

  return {
    isCandidate: sharedTopic && !vagueTokenOnlyOverlap && (correctionIntent || preferenceEvolution),
    duplicate: false,
    sharedTopic,
    correctionIntent,
    preferenceEvolution,
    vagueTokenOnlyOverlap,
  };
}
