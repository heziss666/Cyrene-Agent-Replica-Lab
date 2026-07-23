import type {
  CurrencyWarCharacterInstance,
  CurrencyWarEditorOptions,
  CurrencyWarGameState,
  CurrencyWarGamesApi,
  CurrencyWarStatePatch,
} from "../../shared/currency-war-api-types.js";
import {
  createCharacterInstance,
  createShopSlot,
  getCharacterCosts,
  getCharactersForCost,
  numberCharacterInstances,
  replaceCharacterForCost,
} from "./currency-war-character-editor.js";
import {
  formatNumberedCharacter,
  getAdvisorOptions,
  removeCharacterAssignments,
  removeInventoryAssignments,
} from "./currency-war-equipment-editor.js";
import {
  createCurrencyWarStateViewModel,
  type CurrencyWarStateViewSnapshot,
} from "./currency-war-state-view-model.js";

export interface CurrencyWarStateViewController {
  load(gameId: string): Promise<void>;
  flush(): Promise<void>;
  discard(): Promise<void>;
  reset(): Promise<void>;
}

export function mountCurrencyWarStateView(options: {
  root: HTMLElement;
  api: Pick<CurrencyWarGamesApi, "get" | "update" | "reset" | "getEditorOptions">;
  confirm?: (message: string) => boolean | Promise<boolean>;
}): CurrencyWarStateViewController {
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  let editorOptions: CurrencyWarEditorOptions | undefined;
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

  function edit(patch: CurrencyWarStatePatch): void {
    model.edit(patch);
    const state = model.snapshot().state;
    if (state) render(state);
  }

  function render(state: CurrencyWarGameState): void {
    if (!editorOptions) {
      options.root.innerHTML = `<p class="game-state-unavailable">角色数据不可用，暂时无法编辑当前对局。</p>`;
      return;
    }
    const numbered = numberCharacterInstances(state.board, state.bench);
    options.root.innerHTML = `
      <div class="game-state-toolbar">
        <div><h2>${escapeHtml(state.name)}</h2><p>标准博弈 · 最高难度 · 4.4</p></div>
        <div class="game-state-toolbar-actions"><span data-save-status>${saveLabel(model.snapshot().saveStatus)}</span><button type="button" data-action="reset">重置对局</button></div>
      </div>
      <div class="game-state-grid">
        ${section("进度与经济", `<div class="game-field-grid">
          ${selectField("节点", "nodeId", standardNodeOptions(state.nodeId))}
          ${selectField("状态", "status", optionList(["active", "won", "lost"], state.status))}
          ${numberField("生命", "teamHealth", state.teamHealth)}
          ${numberField("金币", "gold", state.gold)}
          ${numberField("等级", "level", state.level)}
          ${numberField("经验", "experience", state.experience)}
          ${numberField("连胜（可空）", "winStreak", state.winStreak ?? "")}
        </div>`)}
        ${section("上阵角色", characterRows("board", state.board, editorOptions, 0) + addButton("add-board", "添加上阵角色"))}
        ${section("备战席", characterRows("bench", state.bench, editorOptions, state.board.length) + addButton("add-bench", "添加备战角色"))}
        ${section("商店", shopRows(state, editorOptions) + addButton("add-shop", "添加商店槽位"))}
        ${section("装备库存", inventoryRows(state, editorOptions) + addButton("add-equipment", "添加装备"))}
        ${section("装备分配", assignmentRows(state, numbered) + addButton("add-assignment", "添加分配"))}
        ${section("投资与顾问", `
          ${textField("投资环境", "investmentEnvironment", state.investmentEnvironment ?? "")}
          ${textAreaField("投资策略：位面 | 策略名", "investmentStrategies", state.investmentStrategies.map((item) => `${item.plane} | ${item.strategyName}`).join("\n"))}
          ${selectField("已解锁顾问", "advisorName", `<option value="">未解锁</option>${optionList(getAdvisorOptions(editorOptions.characters).map(({ name }) => name), state.advisorState.name ?? "")}`)}
        `)}
        ${section("备注与问题", `
          ${textAreaField("本局备注", "notes", state.notes)}
          <ul class="game-validation-issues" data-validation-issues></ul>
        `)}
      </div>
    `;
    bindEvents(state, editorOptions);
    updateFeedback(model.snapshot());
  }

  function bindEvents(state: CurrencyWarGameState, available: CurrencyWarEditorOptions): void {
    options.root.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
      element.addEventListener("click", async () => {
        const action = element.dataset.action;
        if (action === "reset") {
          if (await confirm("重置当前对局状态？")) {
            const snapshot = await model.reset();
            if (snapshot.state) render(snapshot.state);
          }
          return;
        }
        handleAction(action ?? "", element.dataset, state, available);
      });
    });
    options.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-field]")
      .forEach((element) => {
        element.addEventListener("change", () => handleField(element, state, available));
      });
  }

  function handleAction(
    action: string,
    data: DOMStringMap,
    state: CurrencyWarGameState,
    available: CurrencyWarEditorOptions,
  ): void {
    const costs = getCharacterCosts(available.characters);
    const firstCost = costs[0] ?? 1;
    const index = Number(data.index);
    if (action === "add-board") {
      edit({ board: [...state.board, createCharacterInstance("board", available.characters, firstCost)] });
    } else if (action === "add-bench") {
      edit({ bench: [...state.bench, createCharacterInstance("bench", available.characters, firstCost)] });
    } else if (action === "remove-unit") {
      const group = data.group === "board" ? "board" : "bench";
      const units = state[group];
      const removed = units[index];
      if (!removed) return;
      edit({
        [group]: units.filter((_, itemIndex) => itemIndex !== index),
        equipmentAssignments: removeCharacterAssignments(state.equipmentAssignments, removed.instanceId),
      });
    } else if (action === "add-shop") {
      edit({ shop: { locked: false, slots: [...state.shop.slots, createShopSlot(state.shop.slots.length + 1, available.characters, firstCost)] } });
    } else if (action === "remove-shop") {
      edit({ shop: { locked: false, slots: state.shop.slots.filter((_, itemIndex) => itemIndex !== index).map((slot, itemIndex) => ({ ...slot, slot: itemIndex + 1 })) } });
    } else if (action === "add-equipment") {
      const equipmentName = available.equipment[0];
      if (!equipmentName) return;
      edit({ inventory: [...state.inventory, { instanceId: crypto.randomUUID(), equipmentName, quantity: 1 }] });
    } else if (action === "remove-equipment") {
      const removed = state.inventory[index];
      if (!removed) return;
      edit({
        inventory: state.inventory.filter((_, itemIndex) => itemIndex !== index),
        equipmentAssignments: removeInventoryAssignments(state.equipmentAssignments, removed.instanceId),
      });
    } else if (action === "add-assignment") {
      const units = numberCharacterInstances(state.board, state.bench);
      const equipment = state.inventory[0];
      if (!units[0] || !equipment) return;
      edit({ equipmentAssignments: [...state.equipmentAssignments, { characterInstanceId: units[0].instanceId, equipmentInstanceId: equipment.instanceId, quantity: 1 }] });
    } else if (action === "remove-assignment") {
      edit({ equipmentAssignments: state.equipmentAssignments.filter((_, itemIndex) => itemIndex !== index) });
    }
  }

  function handleField(
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    state: CurrencyWarGameState,
    available: CurrencyWarEditorOptions,
  ): void {
    const field = element.dataset.field ?? "";
    const index = Number(element.dataset.index);
    const group = element.dataset.group === "board" ? "board" : "bench";
    if (field.startsWith("unit-")) {
      const units = [...state[group]];
      const unit = units[index];
      if (!unit) return;
      if (field === "unit-cost") units[index] = replaceCharacterForCost(unit, available.characters, Number(element.value));
      if (field === "unit-character") units[index] = { ...unit, characterName: element.value };
      if (field === "unit-star") units[index] = { ...unit, star: Number(element.value) };
      if (field === "unit-position") units[index] = { ...unit, position: element.value === "back" ? "back" : "front" };
      edit({ [group]: units });
      return;
    }
    if (field.startsWith("shop-")) {
      const slots = state.shop.slots.map((slot) => ({ ...slot }));
      const slot = slots[index];
      if (!slot) return;
      if (field === "shop-cost") {
        const cost = Number(element.value);
        const candidates = getCharactersForCost(available.characters, cost);
        slot.cost = cost;
        slot.characterName = candidates.some(({ name }) => name === slot.characterName) ? slot.characterName : candidates[0]?.name ?? null;
      }
      if (field === "shop-character") slot.characterName = element.value || null;
      if (field === "shop-star") slot.star = Number(element.value);
      edit({ shop: { locked: false, slots } });
      return;
    }
    if (field === "inventory-equipment" || field === "inventory-quantity") {
      const inventory = state.inventory.map((item) => ({ ...item }));
      if (inventory[index] && field === "inventory-equipment") inventory[index].equipmentName = element.value;
      if (inventory[index] && field === "inventory-quantity") inventory[index].quantity = Number(element.value);
      edit({ inventory });
      return;
    }
    if (field === "assignment-character" || field === "assignment-equipment" || field === "assignment-quantity") {
      const assignments = state.equipmentAssignments.map((item) => ({ ...item }));
      if (!assignments[index]) return;
      if (field === "assignment-character") assignments[index].characterInstanceId = element.value;
      if (field === "assignment-equipment") assignments[index].equipmentInstanceId = element.value;
      if (field === "assignment-quantity") assignments[index].quantity = Number(element.value);
      edit({ equipmentAssignments: assignments });
      return;
    }
    edit(readSimplePatch(element, state));
  }

  return {
    async load(gameId) {
      if (!editorOptions) {
        try {
          editorOptions = await options.api.getEditorOptions();
        } catch {
          editorOptions = { characters: [], equipment: [] };
        }
      }
      const snapshot = await model.load(gameId);
      if (snapshot.state) render(snapshot.state);
    },
    async flush() {
      await model.flush();
      if (model.snapshot().saveStatus === "error") {
        throw new Error("GAME_STATE_SAVE_FAILED");
      }
    },
    discard: () => model.discard(),
    async reset() {
      const snapshot = await model.reset();
      if (snapshot.state) render(snapshot.state);
    },
  };
}

function characterRows(
  group: "board" | "bench",
  units: CurrencyWarCharacterInstance[],
  options: CurrencyWarEditorOptions,
  offset: number,
): string {
  return units.map((unit, index) => {
    const cost = unit.cost;
    const characters = getCharactersForCost(options.characters, cost).map(({ name }) => name);
    return `<div class="game-editor-row character-editor-row ${group === "bench" ? "is-bench" : ""}">
      <span class="game-row-number">${offset + index + 1}号</span>
      ${rowSelect("费用", "unit-cost", optionList(getCharacterCosts(options.characters).map(String), String(cost)), group, index)}
      ${rowSelect("角色", "unit-character", optionListWithUnknown(characters, unit.characterName), group, index)}
      ${rowSelect("星级", "unit-star", optionList(["1", "2", "3"], String(unit.star)), group, index)}
      ${group === "board" ? rowSelect("位置", "unit-position", optionList(["front", "back"], unit.position), group, index) : ""}
      ${removeButton("remove-unit", group, index)}
    </div>`;
  }).join("") || emptyText("尚未添加角色");
}

function shopRows(state: CurrencyWarGameState, options: CurrencyWarEditorOptions): string {
  return state.shop.slots.map((slot, index) => {
    const cost = slot.cost;
    const characters = getCharactersForCost(options.characters, cost).map(({ name }) => name);
    return `<div class="game-editor-row shop-editor-row">
      <span class="game-row-number">${index + 1}号</span>
      ${rowSelect("费用", "shop-cost", optionList(getCharacterCosts(options.characters).map(String), String(cost)), "shop", index)}
      ${rowSelect("角色", "shop-character", optionListWithUnknown(characters, slot.characterName ?? ""), "shop", index)}
      ${rowSelect("星级", "shop-star", optionList(["1", "2"], String(slot.star)), "shop", index)}
      ${removeButton("remove-shop", "shop", index)}
    </div>`;
  }).join("") || emptyText("尚未添加商店角色");
}

function inventoryRows(state: CurrencyWarGameState, options: CurrencyWarEditorOptions): string {
  return state.inventory.map((item, index) => `<div class="game-editor-row inventory-editor-row">
    <span class="game-row-number">${index + 1}号</span>
    ${rowSelect("装备", "inventory-equipment", optionListWithUnknown(options.equipment, item.equipmentName), "inventory", index)}
    ${rowNumber("数量", "inventory-quantity", item.quantity, "inventory", index)}
    ${removeButton("remove-equipment", "inventory", index)}
  </div>`).join("") || emptyText("尚未添加装备");
}

function assignmentRows(
  state: CurrencyWarGameState,
  units: ReturnType<typeof numberCharacterInstances>,
): string {
  return state.equipmentAssignments.map((assignment, index) => `<div class="game-editor-row assignment-editor-row">
    ${rowSelect("角色", "assignment-character", units.map((unit) => `<option value="${escapeHtml(unit.instanceId)}" ${unit.instanceId === assignment.characterInstanceId ? "selected" : ""}>${escapeHtml(formatNumberedCharacter(unit))}</option>`).join(""), "assignment", index)}
    ${rowSelect("装备", "assignment-equipment", state.inventory.map((item, itemIndex) => `<option value="${escapeHtml(item.instanceId)}" ${item.instanceId === assignment.equipmentInstanceId ? "selected" : ""}>${itemIndex + 1}号 ${escapeHtml(item.equipmentName)}</option>`).join(""), "assignment", index)}
    ${rowNumber("数量", "assignment-quantity", assignment.quantity, "assignment", index)}
    ${removeButton("remove-assignment", "assignment", index)}
  </div>`).join("") || emptyText("尚未分配装备");
}

function readSimplePatch(
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
    case "investmentEnvironment": return { investmentEnvironment: value.trim() || null };
    case "investmentStrategies": return { investmentStrategies: parseStrategies(value) };
    case "advisorName": return { advisorState: value ? { unlocked: true, name: value } : { unlocked: false, name: null } };
    case "notes": return { notes: value };
    default: return { notes: state.notes };
  }
}

function parseStrategies(text: string): CurrencyWarGameState["investmentStrategies"] {
  return nonEmptyLines(text).flatMap((line) => {
    const [planeText, strategyName = ""] = line.split("|").map((part) => part.trim());
    const plane = Number.parseInt(planeText, 10);
    return plane >= 1 && plane <= 3 && strategyName ? [{ plane: plane as 1 | 2 | 3, strategyName }] : [];
  });
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function section(title: string, body: string): string {
  return `<section class="game-state-section"><h3>${title}</h3>${body}</section>`;
}

function addButton(action: string, label: string): string {
  return `<button class="game-add-button" type="button" data-action="${action}">+ ${label}</button>`;
}

function removeButton(action: string, group: string, index: number): string {
  return `<button class="game-row-remove" type="button" data-action="${action}" data-group="${group}" data-index="${index}" aria-label="删除">删除</button>`;
}

function rowSelect(label: string, field: string, options: string, group: string, index: number): string {
  return `<label class="game-row-field"><span>${label}</span><select data-field="${field}" data-group="${group}" data-index="${index}">${options}</select></label>`;
}

function rowNumber(label: string, field: string, value: number, group: string, index: number): string {
  return `<label class="game-row-field game-row-number-input"><span>${label}</span><input type="number" min="1" step="1" data-field="${field}" data-group="${group}" data-index="${index}" value="${value}"/></label>`;
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
  return optionList([
    ...Array.from({ length: 9 }, (_, index) => `1-${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `2-${index + 1}`),
    ...Array.from({ length: 7 }, (_, index) => `3-${index + 1}`),
  ], selected);
}

function optionList(values: readonly string[], selected: string): string {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function optionListWithUnknown(values: readonly string[], selected: string): string {
  const all = selected && !values.includes(selected) ? [selected, ...values] : values;
  return optionList(all, selected);
}

function saveLabel(status: CurrencyWarStateViewSnapshot["saveStatus"]): string {
  return { idle: "未修改", dirty: "待保存", saving: "保存中…", saved: "已保存", error: "保存失败" }[status];
}

function emptyText(text: string): string {
  return `<p class="game-editor-empty">${text}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}
