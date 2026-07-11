export function validateVector(vector: number[], label: string): void {
  if (vector.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  for (let index = 0; index < vector.length; index += 1) {
    if (!Number.isFinite(vector[index])) {
      throw new Error(`${label} contains a non-finite value at index ${index}`);
    }
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  validateVector(a, "First vector");
  validateVector(b, "Second vector");

  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    throw new Error("Cosine similarity is undefined for a zero vector");
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
