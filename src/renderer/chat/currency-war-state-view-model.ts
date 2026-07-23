import type {
  CurrencyWarGameState,
  CurrencyWarStateApi,
  CurrencyWarStatePatch,
  CurrencyWarValidationIssue,
} from "../../shared/currency-war-api-types.js";

export type CurrencyWarSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface CurrencyWarStateViewSnapshot {
  conversationId: string;
  state?: CurrencyWarGameState;
  saveStatus: CurrencyWarSaveStatus;
  issues: CurrencyWarValidationIssue[];
}

export function createCurrencyWarStateViewModel(options: {
  api: CurrencyWarStateApi;
  debounceMs?: number;
  onChange?: (snapshot: CurrencyWarStateViewSnapshot) => void;
}) {
  const debounceMs = options.debounceMs ?? 600;
  let conversationId = "";
  let state: CurrencyWarGameState | undefined;
  let saveStatus: CurrencyWarSaveStatus = "idle";
  let issues: CurrencyWarValidationIssue[] = [];
  let revision = 0;
  let savedRevision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saveTail = Promise.resolve();

  function snapshot(): CurrencyWarStateViewSnapshot {
    return {
      conversationId,
      state: state ? structuredClone(state) : undefined,
      saveStatus,
      issues: structuredClone(issues),
    };
  }

  function notify(): void {
    options.onChange?.(snapshot());
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, debounceMs);
  }

  async function saveCurrent(): Promise<void> {
    if (!state || !conversationId || savedRevision >= revision) return;
    const targetRevision = revision;
    const localState = structuredClone(state);
    saveStatus = "saving";
    notify();
    const result = await options.api.update(conversationId, toPatch(localState));
    issues = result.issues;
    if (!result.saved) {
      saveStatus = "error";
      notify();
      return;
    }
    savedRevision = targetRevision;
    if (revision === targetRevision) state = result.state;
    saveStatus = savedRevision < revision ? "dirty" : "saved";
    notify();
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    saveTail = saveTail.then(async () => {
      while (savedRevision < revision && saveStatus !== "error") {
        await saveCurrent();
      }
    });
    await saveTail;
  }

  return {
    snapshot,

    async load(nextConversationId: string) {
      if (conversationId && conversationId !== nextConversationId) await flush();
      conversationId = nextConversationId;
      state = await options.api.get(nextConversationId);
      revision = 0;
      savedRevision = 0;
      issues = [];
      saveStatus = "idle";
      notify();
      return snapshot();
    },

    edit(patch: CurrencyWarStatePatch) {
      if (!state) throw new Error("GAME_STATE_NOT_LOADED");
      state = { ...state, ...structuredClone(patch) };
      revision += 1;
      saveStatus = "dirty";
      issues = [];
      notify();
      schedule();
    },

    flush,

    async reset() {
      if (!conversationId) throw new Error("GAME_STATE_NOT_LOADED");
      if (timer) clearTimeout(timer);
      timer = undefined;
      state = await options.api.reset(conversationId);
      revision = 0;
      savedRevision = 0;
      issues = [];
      saveStatus = "saved";
      notify();
      return snapshot();
    },
  };
}

function toPatch(state: CurrencyWarGameState): CurrencyWarStatePatch {
  const {
    schemaVersion: _schemaVersion,
    gameVersion: _gameVersion,
    conversationId: _conversationId,
    mode: _mode,
    difficulty: _difficulty,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...patch
  } = state;
  return patch;
}
