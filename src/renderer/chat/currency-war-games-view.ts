import type { CurrencyWarGamesApi } from "../../shared/currency-war-api-types.js";
import { mountCurrencyWarStateView } from "./currency-war-state-view.js";

export interface CurrencyWarGamesViewController {
  show(): Promise<void>;
  flush(): Promise<void>;
}

export function mountCurrencyWarGamesView(options: {
  root: HTMLElement;
  api: CurrencyWarGamesApi;
  confirm?: (message: string) => boolean | Promise<boolean>;
  prompt?: (message: string, initial?: string) => string | null;
  copyText?: (text: string) => Promise<void>;
}): CurrencyWarGamesViewController {
  const confirm = options.confirm ?? ((message) => window.confirm(message));
  const prompt = options.prompt ?? ((message, initial) => window.prompt(message, initial));
  const copyText = options.copyText ?? ((text) => navigator.clipboard.writeText(text));
  options.root.innerHTML = `
    <div class="currency-war-games-toolbar">
      <label><span>当前对局</span><select data-game-select></select></label>
      <button type="button" data-game-action="create">新建</button>
      <button type="button" data-game-action="rename">重命名</button>
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
  const count = required<HTMLElement>("[data-game-count]");
  const summaryWrap = required<HTMLElement>("[data-game-summary-wrap]");
  const summary = required<HTMLTextAreaElement>("[data-game-summary]");
  const editor = mountCurrencyWarStateView({ root: editorRoot, api: options.api, confirm });
  let activeGameId = "";
  let initialized = false;

  async function refresh(loadEditor = true): Promise<void> {
    const result = await options.api.list();
    activeGameId = result.activeGameId;
    select.replaceChildren(...result.games.map((game) => {
      const item = document.createElement("option");
      item.value = game.gameId;
      item.textContent = `${game.name} · ${game.nodeId}`;
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
      const name = prompt("输入对局名称", current.name);
      if (name === null) return;
      await options.api.rename(activeGameId, name);
      await refresh();
    } else if (action === "remove") {
      if (!await confirm("删除当前对局？")) return;
      await options.api.remove(activeGameId);
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
