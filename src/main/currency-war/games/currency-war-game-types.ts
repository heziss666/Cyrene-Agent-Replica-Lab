import type {
  CurrencyWarGameIndexEntry,
  CurrencyWarGameState,
} from "../../../shared/currency-war-api-types.js";

export const CURRENCY_WAR_GAME_INDEX_SCHEMA_VERSION = 1;

export interface CurrencyWarGameIndexFile {
  schemaVersion: 1;
  activeGameId?: string;
  games: CurrencyWarGameIndexEntry[];
}

export function toCurrencyWarGameIndexEntry(state: CurrencyWarGameState): CurrencyWarGameIndexEntry {
  return {
    gameId: state.gameId,
    name: state.name,
    nodeId: state.nodeId,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}
