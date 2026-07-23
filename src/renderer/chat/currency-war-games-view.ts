import type { CurrencyWarGamesApi } from "../../shared/currency-war-api-types.js";
import { createCurrencyWarGamesOperations } from "./currency-war-games-operations.js";
import { mountCurrencyWarStateView } from "./currency-war-state-view.js";

export interface CurrencyWarGamesViewController {
  show(): Promise<void>;
  flush(): Promise<void>;
}

export function mountCurrencyWarGamesView(options: {
  root: HTMLElement;
  api: CurrencyWarGamesApi;
  confirm?: (message: string) => boolean | Promise<boolean>;
  copyText?: (text: string) => Promise<void>;
}): CurrencyWarGamesViewController {
  const confirm = options.confirm ?? ((message) => window.confirm(message));
  const copyText = options.copyText ?? ((text) => navigator.clipboard.writeText(text));
  options.root.innerHTML = `
    <div class="currency-war-games-toolbar">
      <label><span>当前对局</span><select data-game-select></select></label>
      <label data-game-name-wrap hidden><span>对局名称</span><input data-game-name maxlength="60"/></label>
      <button type="button" data-game-action="create">新建</button>
      <button type="button" data-game-action="rename">重命名</button>
      <button type="button" data-game-action="save-rename" hidden>保存名称</button>
      <button type="button" data-game-action="cancel-rename" hidden>取消</button>
      <button type="button" data-game-action="remove">删除</button>
      <button type="button" data-game-action="summary">总结并复制</button>
      <span data-game-count></span>
    </div>
    <div data-game-editor></div>
    <section class="currency-war-summary" data-game-summary-wrap hidden>
      <div><h3>对局摘要</h3><button type="button" data-game-action="copy">复制</button></div>
      <textarea data-game-summary readonly rows="14"></textarea>
    </section>
  `;
  const editorRoot = required<HTMLElement>("[data-game-editor]");
  const select = required<HTMLSelectElement>("[data-game-select]");
  const nameWrap = required<HTMLElement>("[data-game-name-wrap]");
  const nameInput = required<HTMLInputElement>("[data-game-name]");
  const count = required<HTMLElement>("[data-game-count]");
  const summaryWrap = required<HTMLElement>("[data-game-summary-wrap]");
  const summary = required<HTMLTextAreaElement>("[data-game-summary]");
  const editor = mountCurrencyWarStateView({ root: editorRoot, api: options.api, confirm });
  const operations = createCurrencyWarGamesOperations({ api: options.api, editor });
  let activeGameId = "";
  let initialized = false;

  async function refresh(loadEditor = true): Promise<void> {
    const result = await options.api.list();
    activeGameId = result.activeGameId;
    select.replaceChildren(...result.games.map((game) => {
      const item = document.createElement("option");
      item.value = game.gameId;
      item.textContent = game.name;
      item.selected = game.gameId === result.activeGameId;
      return item;
    }));
    count.textContent = `${result.games.length}/${result.maxGames}`;
    const createButton = options.root.querySelector<HTMLButtonElement>('[data-game-action="create"]');
    if (createButton) createButton.disabled = result.games.length >= result.maxGames;
    if (loadEditor) await editor.load(activeGameId);
  }

  async function switchTo(gameId: string): Promise<void> {
    await editor.flush();
    await options.api.setActive(gameId);
    activeGameId = gameId;
    summaryWrap.hidden = true;
    await refresh();
  }

  select.addEventListener("change", () => {
    const previous = activeGameId;
    void switchTo(select.value).catch(() => { select.value = previous; });
  });
  options.root.querySelectorAll<HTMLButtonElement>("[data-game-action]").forEach((button) => {
    button.addEventListener("click", () => void handleAction(button.dataset.gameAction ?? ""));
  });

  async function handleAction(action: string): Promise<void> {
    if (action === "create") {
      await editor.flush();
      const state = await options.api.create();
      activeGameId = state.gameId;
      await refresh();
    } else if (action === "rename") {
      const current = await options.api.get(activeGameId);
      nameInput.value = current.name;
      setRenameMode(true);
      nameInput.focus();
      nameInput.select();
    } else if (action === "save-rename") {
      await operations.rename(activeGameId, nameInput.value);
      setRenameMode(false);
      await refresh();
    } else if (action === "cancel-rename") {
      setRenameMode(false);
    } else if (action === "remove") {
      if (!await confirm("删除当前对局？")) return;
      activeGameId = await operations.remove(activeGameId);
      setRenameMode(false);
      summaryWrap.hidden = true;
      await refresh();
    } else if (action === "summary") {
      await editor.flush();
      summary.value = await options.api.summarize(activeGameId);
      summaryWrap.hidden = false;
      await copyText(summary.value);
    } else if (action === "copy" && summary.value) {
      await copyText(summary.value);
    }
  }

  function setRenameMode(enabled: boolean): void {
    nameWrap.hidden = !enabled;
    select.parentElement!.hidden = enabled;
    for (const action of ["rename", "create", "remove", "summary"]) {
      const button = options.root.querySelector<HTMLButtonElement>(`[data-game-action="${action}"]`);
      if (button) button.hidden = enabled;
    }
    for (const action of ["save-rename", "cancel-rename"]) {
      const button = options.root.querySelector<HTMLButtonElement>(`[data-game-action="${action}"]`);
      if (button) button.hidden = !enabled;
    }
  }

  return {
    async show() {
      if (!initialized) {
        await refresh();
        initialized = true;
      } else {
        await refresh(false);
      }
    },
    flush: () => initialized ? editor.flush() : Promise.resolve(),
  };

  function required<T extends Element>(selector: string): T {
    const element = options.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing currency war games element: ${selector}`);
    return element;
  }
}
