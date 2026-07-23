import type {
  CurrencyWarCharacterInstance,
  CurrencyWarGameState,
  CurrencyWarPosition,
  CurrencyWarShopSlot,
  CurrencyWarStateApi,
  CurrencyWarStatePatch,
} from "../../shared/currency-war-api-types.js";
import {
  createCurrencyWarStateViewModel,
  type CurrencyWarStateViewSnapshot,
} from "./currency-war-state-view-model.js";

export interface CurrencyWarStateViewController {
  load(conversationId: string): Promise<void>;
  flush(): Promise<void>;
  reset(): Promise<void>;
}

export function mountCurrencyWarStateView(options: {
  root: HTMLElement;
  api: CurrencyWarStateApi;
  confirm?: (message: string) => boolean | Promise<boolean>;
}): CurrencyWarStateViewController {
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  const model = createCurrencyWarStateViewModel({
    api: options.api,
    onChange: updateFeedback,
  });

  function updateFeedback(snapshot: CurrencyWarStateViewSnapshot): void {
    const status = options.root.querySelector<HTMLElement>("[data-save-status]");
    if (status) status.textContent = saveLabel(snapshot.saveStatus);
    const issues = options.root.querySelector<HTMLElement>("[data-validation-issues]");
    if (issues) {
      issues.replaceChildren(...snapshot.issues.map((item) => {
        const row = document.createElement("li");
        row.textContent = `${item.path || "state"}：${item.message}`;
        return row;
      }));
    }
  }

  function render(state: CurrencyWarGameState): void {
    options.root.innerHTML = `
      <div class="game-state-toolbar">
        <div><h2>当前对局</h2><p>标准博弈 · 最高难度 · 4.4</p></div>
        <div class="game-state-toolbar-actions"><span data-save-status>未修改</span><button type="button" data-reset>重置对局</button></div>
      </div>
      <div class="game-state-grid">
        ${section("进度与经济", `
          <div class="game-field-grid">
            ${selectField("节点", "nodeId", standardNodeOptions(state.nodeId))}
            ${selectField("状态", "status", optionList(["active", "won", "lost"], state.status))}
            ${numberField("生命", "teamHealth", state.teamHealth)}
            ${numberField("金币", "gold", state.gold)}
            ${numberField("等级", "level", state.level)}
            ${numberField("经验", "experience", state.experience)}
            ${numberField("连胜（可空）", "winStreak", state.winStreak ?? "")}
          </div>
        `)}
        ${section("阵容", `
          ${textAreaField("上阵角色：角色 | 星级 | front/back", "board", formatCharacters(state.board))}
          ${textAreaField("备战席：角色 | 星级", "bench", formatCharacters(state.bench))}
        `)}
        ${section("商店", `
          <label class="game-check"><input data-field="shopLocked" type="checkbox" ${state.shop.locked ? "checked" : ""}/> 锁定商店</label>
          ${textAreaField("角色用逗号分隔，空位保留", "shop", state.shop.slots.map((slot) => slot.characterName ?? "").join(", "))}
        `)}
        ${section("装备", `
          ${textAreaField("库存：每行一件装备", "inventory", state.inventory.map((item) => item.equipmentName).join("\n"))}
          ${textAreaField("分配：装备序号 > 角色名", "assignments", formatAssignments(state))}
        `)}
        ${section("投资与顾问", `
          ${textField("投资环境", "investmentEnvironment", state.investmentEnvironment ?? "")}
          ${textAreaField("投资策略：位面 | 策略名", "investmentStrategies", state.investmentStrategies.map((item) => `${item.plane} | ${item.strategyName}`).join("\n"))}
          <label class="game-check"><input data-field="advisorUnlocked" type="checkbox" ${state.advisorState.unlocked ? "checked" : ""}/> 已解锁顾问</label>
          ${textField("顾问名称", "advisorName", state.advisorState.name ?? "")}
          ${textAreaField("特殊资源：名称 = 数量", "specialResources", Object.entries(state.specialResources).map(([key, value]) => `${key} = ${value}`).join("\n"))}
        `)}
        ${section("备注与问题", `
          ${textAreaField("本局备注", "notes", state.notes)}
          <ul class="game-validation-issues" data-validation-issues></ul>
        `)}
      </div>
    `;

    options.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-field]")
      .forEach((element) => {
        element.addEventListener("change", () => model.edit(readPatch(element, model.snapshot().state!)));
      });
    options.root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", async () => {
      if (await confirm("重置当前会话的对局状态？")) {
        await model.reset();
        render(model.snapshot().state!);
      }
    });
  }

  return {
    async load(conversationId) {
      const snapshot = await model.load(conversationId);
      if (snapshot.state) render(snapshot.state);
    },
    flush: () => model.flush(),
    async reset() {
      const snapshot = await model.reset();
      if (snapshot.state) render(snapshot.state);
    },
  };
}

export function parseCharacterLines(
  text: string,
  group: "board" | "bench",
): CurrencyWarCharacterInstance[] {
  return nonEmptyLines(text).map((line, index) => {
    const [characterName = "", starText = "1", positionText = ""] = line.split("|").map((part) => part.trim());
    const position: CurrencyWarPosition = group === "bench"
      ? "bench"
      : positionText === "back" ? "back" : "front";
    return {
      instanceId: `${group}-${index + 1}`,
      characterName,
      star: Math.max(1, Number.parseInt(starText, 10) || 1),
      position,
    };
  });
}

export function parseShopNames(text: string): CurrencyWarShopSlot[] {
  if (!text.trim()) return [];
  return text.split(",").map((name, index) => ({
    slot: index + 1,
    characterName: name.trim() || null,
  }));
}

function readPatch(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  state: CurrencyWarGameState,
): CurrencyWarStatePatch {
  const field = element.dataset.field;
  const value = element.value;
  switch (field) {
    case "nodeId": return { nodeId: value };
    case "status": return { status: value as CurrencyWarGameState["status"] };
    case "teamHealth":
    case "gold":
    case "level":
    case "experience":
      return { [field]: Number.parseInt(value, 10) } as CurrencyWarStatePatch;
    case "winStreak": return { winStreak: value.trim() ? Number.parseInt(value, 10) : null };
    case "board": return { board: parseCharacterLines(value, "board") };
    case "bench": return { bench: parseCharacterLines(value, "bench") };
    case "shop": return { shop: { ...state.shop, slots: parseShopNames(value) } };
    case "shopLocked": return { shop: { ...state.shop, locked: (element as HTMLInputElement).checked } };
    case "inventory":
      return { inventory: nonEmptyLines(value).map((equipmentName, index) => ({ instanceId: `equipment-${index + 1}`, equipmentName })) };
    case "assignments": return { equipmentAssignments: parseAssignments(value, state) };
    case "investmentEnvironment": return { investmentEnvironment: value.trim() || null };
    case "investmentStrategies":
      return {
        investmentStrategies: nonEmptyLines(value).flatMap((line) => {
          const [planeText, strategyName = ""] = line.split("|").map((part) => part.trim());
          const plane = Number.parseInt(planeText, 10);
          return plane >= 1 && plane <= 3 && strategyName
            ? [{ plane: plane as 1 | 2 | 3, strategyName }]
            : [];
        }),
      };
    case "advisorUnlocked": return { advisorState: { ...state.advisorState, unlocked: (element as HTMLInputElement).checked } };
    case "advisorName": return { advisorState: { ...state.advisorState, name: value.trim() || null } };
    case "specialResources": return { specialResources: parseResources(value) };
    case "notes": return { notes: value };
    default: return {};
  }
}

function parseAssignments(text: string, state: CurrencyWarGameState): CurrencyWarGameState["equipmentAssignments"] {
  const characters = [...state.board, ...state.bench];
  return nonEmptyLines(text).flatMap((line) => {
    const [equipmentIndexText, characterName = ""] = line.split(">").map((part) => part.trim());
    const equipment = state.inventory[Number.parseInt(equipmentIndexText, 10) - 1];
    const character = characters.find((item) => item.characterName === characterName);
    return equipment && character
      ? [{ equipmentInstanceId: equipment.instanceId, characterInstanceId: character.instanceId }]
      : [];
  });
}

function parseResources(text: string): Record<string, number> {
  return Object.fromEntries(nonEmptyLines(text).flatMap((line) => {
    const [name = "", countText = ""] = line.split("=").map((part) => part.trim());
    const count = Number.parseInt(countText, 10);
    return name && Number.isFinite(count) ? [[name, count]] : [];
  }));
}

function formatAssignments(state: CurrencyWarGameState): string {
  const characters = [...state.board, ...state.bench];
  return state.equipmentAssignments.flatMap((assignment) => {
    const equipmentIndex = state.inventory.findIndex((item) => item.instanceId === assignment.equipmentInstanceId);
    const character = characters.find((item) => item.instanceId === assignment.characterInstanceId);
    return equipmentIndex >= 0 && character ? [`${equipmentIndex + 1} > ${character.characterName}`] : [];
  }).join("\n");
}

function formatCharacters(characters: CurrencyWarCharacterInstance[]): string {
  return characters.map((unit) => `${unit.characterName} | ${unit.star} | ${unit.position}`).join("\n");
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function section(title: string, body: string): string {
  return `<section class="game-state-section"><h3>${title}</h3>${body}</section>`;
}

function textField(label: string, field: string, value: string): string {
  return `<label class="game-field"><span>${label}</span><input data-field="${field}" value="${escapeHtml(value)}"/></label>`;
}

function numberField(label: string, field: string, value: number | string): string {
  return `<label class="game-field"><span>${label}</span><input data-field="${field}" type="number" min="0" value="${value}"/></label>`;
}

function textAreaField(label: string, field: string, value: string): string {
  return `<label class="game-field game-field-wide"><span>${label}</span><textarea data-field="${field}" rows="3">${escapeHtml(value)}</textarea></label>`;
}

function selectField(label: string, field: string, options: string): string {
  return `<label class="game-field"><span>${label}</span><select data-field="${field}">${options}</select></label>`;
}

function standardNodeOptions(selected: string): string {
  const ids = [
    ...Array.from({ length: 9 }, (_, index) => `1-${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `2-${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `3-${index + 1}`),
  ];
  return optionList(ids, selected);
}

function optionList(values: readonly string[], selected: string): string {
  return values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
}

function saveLabel(status: CurrencyWarStateViewSnapshot["saveStatus"]): string {
  return { idle: "未修改", dirty: "待保存", saving: "保存中…", saved: "已保存", error: "保存失败" }[status];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}
