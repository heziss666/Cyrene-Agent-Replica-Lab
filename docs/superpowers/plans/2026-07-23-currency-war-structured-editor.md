# Currency War Structured Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用费用、角色、星级等结构化控件替换 GameState 的文本录入，并让装备序号和当前 Conversation 始终正确绑定。

**Architecture:** 主进程从 CurrencyWar Catalog 生成只读编辑选项，经 IPC/preload 提供给 Renderer。Renderer 将阵容、商店和装备拆为独立编辑模块，界面序号映射到稳定 `instanceId`，GameState Service 继续负责最终校验与持久化。

**Tech Stack:** TypeScript、Electron IPC、原生 DOM、Vitest、现有 CurrencyWar Runtime Catalog。

## Global Constraints

- 仅支持游戏版本 4.4、标准博弈、最高难度。
- 角色选择顺序固定为“费用 → 角色 → 当前星级”。
- 上阵角色额外选择前台或后台，备战席不显示位置选择。
- 当前 Chat Conversation 是 GameState 的唯一选择来源。
- Renderer 不直接读取 `data/` 文件，不硬编码 72 个角色。
- 装备关系始终保存 `characterInstanceId` 和 `equipmentInstanceId`，不保存界面序号。
- 删除商店锁定和顾问解锁复选框。

---

### Task 1: 编辑器选项与商店星级协议

**Files:**
- Modify: `src/shared/currency-war-api-types.ts`
- Modify: `src/main/currency-war/state/game-state-factory.ts`
- Modify: `src/main/currency-war/state/game-state-migrations.ts`
- Modify: `src/main/currency-war/state/game-state-service.ts`
- Modify: `tests/currency-war/state/game-state-factory.test.ts`
- Modify: `tests/currency-war/state/game-state-migrations.test.ts`
- Modify: `tests/currency-war/state/game-state-service.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarCatalog.list("characters" | "equipment")`
- Produces: `CurrencyWarEditorOptions` and `CurrencyWarGameStateService.getEditorOptions()`

- [ ] **Step 1: 写失败测试**

新增断言：

```ts
expect(state.shop.slots).toEqual([]);
expect(migrated.shop.slots[0]).toEqual({
  slot: 1,
  characterName: "翡翠",
  star: 1,
});
expect(await service.getEditorOptions()).toEqual({
  characters: [
    { name: "角色A", costs: [1], advisor: false },
    { name: "角色B", costs: [2, 3], advisor: true },
  ],
  equipment: ["装备A"],
});
```

测试 Catalog 返回的 `cost: number | number[]` 都转换成已排序、去重的 `costs`。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/currency-war/state/game-state-factory.test.ts tests/currency-war/state/game-state-migrations.test.ts tests/currency-war/state/game-state-service.test.ts`

Expected: FAIL，缺少 `star` 或 `getEditorOptions`。

- [ ] **Step 3: 实现共享类型**

```ts
export interface CurrencyWarShopSlot {
  slot: number;
  characterName: string | null;
  star: number;
}

export interface CurrencyWarCharacterOption {
  name: string;
  costs: number[];
  advisor: boolean;
}

export interface CurrencyWarEditorOptions {
  characters: CurrencyWarCharacterOption[];
  equipment: string[];
}
```

为 `CurrencyWarStateApi` 增加：

```ts
getEditorOptions(): Promise<CurrencyWarEditorOptions>;
```

- [ ] **Step 4: 实现迁移和 Service**

旧商店槽位没有星级时补 `star: 1`。`getEditorOptions()` 从 Catalog 构建深拷贝快照；角色按最低费用再按名称排序，装备按名称排序。

- [ ] **Step 5: 验证并提交**

Run: `npx vitest run tests/currency-war/state tests/shared/currency-war-api-types.test.ts`

Expected: PASS。

Commit: `feat: expose currency war editor options`

---

### Task 2: 编辑器选项 IPC 与 preload

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/app/register-currency-war-state-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/shared/ipc-channels.test.ts`
- Modify: `tests/shared/electron-api.test.ts`
- Modify: `tests/main/register-currency-war-state-ipc.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarGameStateService.getEditorOptions()`
- Produces: `window.cyrene.currencyWarState.getEditorOptions()`

- [ ] **Step 1: 写失败测试**

```ts
expect(IPC_CHANNELS.currencyWarState.getEditorOptions)
  .toBe("currency-war:state:get-editor-options");
await ipcMain.handlers.get(IPC_CHANNELS.currencyWarState.getEditorOptions)!({});
expect(service.getEditorOptions).toHaveBeenCalledOnce();
```

Electron API 测试必须包含 `getEditorOptions`，并继续确认无文件系统方法。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/shared/ipc-channels.test.ts tests/shared/electron-api.test.ts tests/main/register-currency-war-state-ipc.test.ts`

Expected: FAIL，Channel 和方法不存在。

- [ ] **Step 3: 实现只读链路**

增加 Channel：

```ts
getEditorOptions: "currency-war:state:get-editor-options"
```

Handler 不接收 payload：

```ts
ipcMain.handle(
  IPC_CHANNELS.currencyWarState.getEditorOptions,
  async () => service.getEditorOptions(),
);
```

preload 增加同名方法，不暴露 Catalog 或路径。

- [ ] **Step 4: 验证并提交**

Run: `npx vitest run tests/shared tests/main/register-currency-war-state-ipc.test.ts`

Expected: PASS。

Commit: `feat: add currency war editor options ipc`

---

### Task 3: 角色与商店结构化编辑模块

**Files:**
- Create: `src/renderer/chat/currency-war-character-editor.ts`
- Modify: `src/renderer/chat/currency-war-state-view.ts`
- Create: `tests/renderer/currency-war-character-editor.test.ts`
- Modify: `tests/renderer/currency-war-state-view.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarCharacterOption[]`, `CurrencyWarCharacterInstance[]`, `CurrencyWarShopSlot[]`
- Produces: `getCharactersForCost`, `createCharacterInstance`, `updateCharacterInstance`, `createShopSlot`, `updateShopSlot`, `numberCharacterInstances`

- [ ] **Step 1: 写纯函数失败测试**

```ts
expect(getCharactersForCost(options, 2).map(({ name }) => name))
  .toEqual(["角色B", "角色C"]);

const numbered = numberCharacterInstances(board, bench);
expect(numbered.map(({ number, instanceId }))).toEqual([
  { number: 1, instanceId: "board-a" },
  { number: 2, instanceId: "bench-a" },
]);
```

还要测试：

- 改费用后，原角色不匹配则切换到该费用第一个角色；
- 改星级不改变 `instanceId`；
- 上阵位置只能是 `front/back`；
- 商店槽位保存费用筛选后的角色和星级；
- 删除角色后调用清理函数移除指向它的装备分配。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/renderer/currency-war-character-editor.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯状态转换**

示例签名：

```ts
export function getCharactersForCost(
  options: readonly CurrencyWarCharacterOption[],
  cost: number,
): CurrencyWarCharacterOption[];

export function numberCharacterInstances(
  board: readonly CurrencyWarCharacterInstance[],
  bench: readonly CurrencyWarCharacterInstance[],
): Array<CurrencyWarCharacterInstance & { number: number }>;
```

所有更新返回新数组，不原地修改 GameState。

- [ ] **Step 4: 实现 DOM 行**

角色行使用 `<select>`，费用列表来自 options。角色下拉只渲染当前费用对应角色，星级固定为 1/2/3。新增与删除都调用 `model.edit()`，不再解析 `角色 | 星级 | 位置` 文本。

商店删除锁定复选框，槽位使用相同三级选择器。

- [ ] **Step 5: 验证并提交**

Run: `npx vitest run tests/renderer/currency-war-character-editor.test.ts tests/renderer/currency-war-state-view.test.ts`

Expected: PASS。

Commit: `feat: add structured character and shop editors`

---

### Task 4: 装备与顾问结构化编辑模块

**Files:**
- Create: `src/renderer/chat/currency-war-equipment-editor.ts`
- Modify: `src/renderer/chat/currency-war-state-view.ts`
- Create: `tests/renderer/currency-war-equipment-editor.test.ts`
- Modify: `tests/renderer/currency-war-state-view.test.ts`

**Interfaces:**
- Consumes: 已编号阵容、装备选项、库存和分配
- Produces: `removeCharacterAssignments`, `removeInventoryAssignments`, `createEquipmentAssignment`, `getAdvisorOptions`

- [ ] **Step 1: 写失败测试**

```ts
expect(removeCharacterAssignments(assignments, "unit-1"))
  .toEqual(assignments.filter(({ characterInstanceId }) => characterInstanceId !== "unit-1"));

expect(getAdvisorOptions(editorOptions.characters).map(({ name }) => name))
  .toEqual(["顾问角色"]);
```

还要测试删除库存装备同步清理分配，以及装备分配显示“序号 + 名称 + 星级”但保存实例 ID。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/renderer/currency-war-equipment-editor.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现装备编辑器**

库存使用装备下拉框。分配角色下拉显示：

```text
1号 黑塔（2星）
```

value 使用 `instanceId`。装备下拉 value 使用 `equipmentInstanceId`。新增分配前过滤已经分配的装备。

- [ ] **Step 4: 实现顾问编辑器**

删除 `advisorUnlocked`。标签改为“已解锁顾问”，空选项表示未解锁：

```ts
const advisorState = selectedName
  ? { unlocked: true, name: selectedName }
  : { unlocked: false, name: null };
```

- [ ] **Step 5: 验证并提交**

Run: `npx vitest run tests/renderer/currency-war-equipment-editor.test.ts tests/renderer/currency-war-state-view.test.ts tests/currency-war/state/game-state-validator.test.ts`

Expected: PASS。

Commit: `feat: add structured equipment and advisor editors`

---

### Task 5: 当前 Conversation 标题与严格切换

**Files:**
- Modify: `src/renderer/chat/currency-war-state-view-model.ts`
- Modify: `src/renderer/chat/currency-war-state-view.ts`
- Modify: `src/renderer/chat/main.ts`
- Modify: `tests/renderer/currency-war-state-view-model.test.ts`
- Modify: `tests/renderer/workspace-shell.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarStateViewController.load(conversationId, title)`
- Produces: 当前对局标题和失败安全的 Conversation 切换

- [ ] **Step 1: 写失败测试**

测试切换顺序：

```ts
model.edit({ gold: 20 });
await model.load("conv_2");
expect(callOrder).toEqual([
  "update:conv_1",
  "get:conv_2",
]);
```

保存失败时 `load("conv_2")` 必须 reject `GAME_STATE_SWITCH_SAVE_FAILED`，并继续显示 `conv_1`。Workspace HTML/源码测试确认对局标题区域存在。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/renderer/currency-war-state-view-model.test.ts tests/renderer/workspace-shell.test.ts`

Expected: FAIL，当前保存失败仍继续切换或没有标题。

- [ ] **Step 3: 实现严格切换**

`flush()` 返回保存结果；若状态为 `error`，`load(nextId)` 抛错且不修改当前 ID。Controller 接收标题：

```ts
load(conversationId: string, conversationTitle: string): Promise<void>;
```

`main.ts` 在 `openConversation` 得到 `ConversationDetail` 后调用：

```ts
await currencyWarPanel.load(detail.id, detail.title);
```

对局页显示 `对局 · <conversationTitle>`，不增加独立会话选择器。

- [ ] **Step 4: 验证并提交**

Run: `npx vitest run tests/renderer`

Expected: PASS。

Commit: `feat: bind structured game editor to active conversation`

---

### Task 6: 清理旧文本编辑路径并完整验收

**Files:**
- Modify: `src/renderer/chat/currency-war-state-view.ts`
- Modify: `src/renderer/chat/style.css`
- Modify: `docs/learning/13-currency-war-game-state.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1-5 的结构化组件
- Produces: 可运行的最终 Electron 对局编辑体验

- [ ] **Step 1: 删除旧文本解析入口**

删除不再使用的：

```ts
parseCharacterLines
parseShopNames
parseAssignments
```

同步删除旧格式文档示例，确保界面和文档不再要求用户输入分隔符。

- [ ] **Step 2: 完善布局**

为角色、商店、库存、装备分配行增加固定网格列、序号列和窄屏换行。所有选择器必须有可见 label；按钮使用新增/删除命令，不允许文本溢出。

- [ ] **Step 3: 运行完整验证**

Run: `npm test`

Expected: 所有 Vitest 测试通过。

Run: `npm run build`

Expected: Electron 和 Renderer 构建成功。

Run: `npm run currency-war:data-check`

Expected: 4.4 数据报告包含 72 个角色且退出码为 0。

- [ ] **Step 4: Electron 手动验收**

Run: `npm run dev:electron`

验证：

1. 当前对局标题与 Chat 当前 Conversation 相同；
2. 选 2 费后只显示 2 费角色；
3. 选择角色后可选 1/2/3 星；
4. 上阵可选前台/后台，备战席没有位置选项；
5. 阵容序号连续；
6. 装备通过序号分配，删除角色或装备后无悬空分配；
7. 商店没有锁定复选框；
8. 顾问没有解锁复选框；
9. 两个 Conversation 保存不同阵容；
10. Chat Agent 读取当前 Conversation 对应阵容。

- [ ] **Step 5: 检查并提交**

Run: `git diff --check && git status --short`

Expected: 无空白错误，无 `dist/`、日志、缓存或用户 GameState。

Commit: `docs: update structured game editor guide`

---

## Plan Review Checklist

- [ ] 费用、角色、星级的选择顺序有测试和实现任务。
- [ ] 上阵、备战席、商店、装备、顾问均已覆盖。
- [ ] 角色序号只用于显示，持久化继续使用实例 ID。
- [ ] 删除角色和装备会清理关联分配。
- [ ] 当前 Conversation 同时决定聊天消息和 GameState。
- [ ] 保存失败不会误切换到另一会话。
- [ ] Renderer 不直接读取数据文件。
- [ ] 没有保留旧文本录入和锁定/解锁复选框。
