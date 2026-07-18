const LEADING_PUNCTUATION = /^[\s\p{P}\p{S}]+/u;

export function generateConversationTitle(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim().replace(LEADING_PUNCTUATION, "").trim();
  if (!normalized) return "New Chat";
  return [...normalized].slice(0, 24).join("");
}
