export interface RecentMemoryTurnSnapshot {
  turnId: string;
  ids: string[];
}

interface RecentMemoryTurn {
  turnId: string;
  ids: Set<string>;
}

const MAX_RETAINED_TURNS = 3;
const PENALTY_PER_TURN = 0.06;
const MAX_PENALTY = 0.12;
const SEMANTIC_SCORE_THRESHOLD = 0.8;

export class RecentMemoryTracker {
  private readonly turns: RecentMemoryTurn[] = [];

  recordInjected(turnId: string, memoryIds: readonly string[]): void {
    this.turns.push({ turnId, ids: new Set(memoryIds) });
    if (this.turns.length > MAX_RETAINED_TURNS) {
      this.turns.shift();
    }
  }

  penaltyFor(memoryId: string, semanticScore: number): number {
    if (semanticScore >= SEMANTIC_SCORE_THRESHOLD) {
      return 0;
    }

    const count = this.turns.reduce(
      (total, turn) => total + (turn.ids.has(memoryId) ? 1 : 0),
      0,
    );
    return Math.min(MAX_PENALTY, count * PENALTY_PER_TURN);
  }

  clear(): void {
    this.turns.length = 0;
  }

  snapshot(): RecentMemoryTurnSnapshot[] {
    return this.turns.map(({ turnId, ids }) => ({
      turnId,
      ids: [...ids],
    }));
  }
}
