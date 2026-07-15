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

function normalize(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function topicTerms(value: string): Set<string> {
  return new Set(
    normalize(value).match(/[a-z0-9]{2,}/g)?.filter((word) => !STOP_WORDS.has(word)) ?? [],
  );
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
    || CORRECTION_PATTERN.test(existingContent);
  const preferenceEvolution = (PREFERENCE_PATTERN.test(newContent)
    || PREFERENCE_PATTERN.test(existingContent))
    && (EVOLUTION_PATTERN.test(newContent) || EVOLUTION_PATTERN.test(existingContent));
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
