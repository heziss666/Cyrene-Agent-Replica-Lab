import type {
  CurrencyWarGameListResult,
  CurrencyWarGameState,
} from "../../shared/currency-war-api-types.js";

export function createCurrencyWarGamesOperations(options: {
  api: {
    rename(gameId: string, name: string): Promise<CurrencyWarGameState>;
    remove(gameId: string): Promise<CurrencyWarGameListResult>;
  };
  editor: { flush(): Promise<void> };
}) {
  return {
    async rename(gameId: string, name: string): Promise<CurrencyWarGameState> {
      await options.editor.flush();
      return options.api.rename(gameId, name);
    },
    async remove(gameId: string): Promise<string> {
      await options.editor.flush();
      return (await options.api.remove(gameId)).activeGameId;
    },
  };
}
