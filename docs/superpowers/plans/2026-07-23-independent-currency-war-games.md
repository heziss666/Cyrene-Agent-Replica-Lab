# Independent Currency War Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Conversation 绑定的单 GameState 重构为最多 10 份的独立对局系统，并支持准确费用、装备数量以及可复制总结。

**Architecture:** 使用独立索引与 session 文件管理 Game ID；Service 负责数量限制、规则、编辑选项与总结；Electron 通过新的 `currencyWarGames` IPC 暴露能力；Renderer 用独立对局控制器管理列表，Chat 不再自动注入状态。

**Tech Stack:** TypeScript、Electron、Vitest、原生 DOM/CSS、JSON 原子写入。

## Global Constraints

- 仅支持 4.4、标准博弈、最高难度。
- 对局与 Conversation 不保存任何关联。
- 最多 10 份对局，至少保留一份。
- 银狼 LV.999 必须支持 3、4、5 费并保留用户所选费用。
- 阵容最高 3 星，商店最高 2 星。
- 删除等级对上阵人数的限制。
- 删除特殊资源。
- 装备库存和分配都使用正整数数量。
- 总结由确定性代码生成，不调用 LLM。

---

### Task 1: 重构 GameState 数据模型与校验

**Files:**
- Modify: `src/shared/currency-war-api-types.ts`
- Modify: `src/main/currency-war/state/game-state-factory.ts`
- Modify: `src/main/currency-war/state/game-state-migrations.ts`
- Modify: `src/main/currency-war/state/game-state-validator.ts`
- Modify: `tests/currency-war/state/game-state-factory.test.ts`
- Modify: `tests/currency-war/state/game-state-migrations.test.ts`
- Modify: `tests/currency-war/state/game-state-validator.test.ts`

**Interfaces:**
- Produces: `CurrencyWarGameState` keyed by `gameId`, with role cost and equipment quantities.

- [ ] **Step 1: 写失败测试**

测试以下结构：

```ts
expect(state).toMatchObject({
  gameId: "game_1",
  name: "新对局",
});
expect(state).not.toHaveProperty("conversationId");
expect(state).not.toHaveProperty("specialResources");
```

并覆盖：

```ts
unit = { instanceId, characterName, cost: 5, star: 2, position };
shopSlot = { slot: 1, characterName, cost: 4, star: 2 };
inventory = { instanceId, equipmentName, quantity: 2 };
assignment = { equipmentInstanceId, characterInstanceId, quantity: 1 };
```

Validator 测试必须证明：

- 银狼 LV.999 的 3/4/5 费均合法；
- 普通 4 费角色不能保存为 5 费；
- 商店 3 星非法；
- 上阵人数超过 level 仍合法；
- 库存数量不足和角色装备总量超过 3 非法。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/currency-war/state`

Expected: FAIL，旧模型仍依赖 Conversation、缺少 cost/quantity。

- [ ] **Step 3: 修改类型与默认工厂**

删除 `conversationId/specialResources`，新增 `gameId/name/cost/quantity`。工厂签名：

```ts
createDefaultGameState(gameId: string, name: string, now?: string): CurrencyWarGameState
```

- [ ] **Step 4: 修改迁移与校验**

旧值缺少 cost 时从 Catalog 不可用，因此迁移仅补安全默认 `cost: 1`，新独立 Store 不加载旧 Conversation 文件。Validator 接收 Catalog 后检查角色费用归属和数量总和，不再产生 `BOARD_EXCEEDS_LEVEL`。

- [ ] **Step 5: 验证并提交**

Run: `npx vitest run tests/currency-war/state`

Expected: PASS。

Commit: `feat: model independent currency war games`

---

### Task 2: 实现独立对局 Store

**Files:**
- Create: `src/main/currency-war/games/currency-war-game-store.ts`
- Create: `src/main/currency-war/games/currency-war-game-types.ts`
- Create: `tests/currency-war/games/currency-war-game-store.test.ts`

**Interfaces:**
- Produces: `CurrencyWarGameStore.initialize/list/load/save/remove/setActive/getActiveId/flush`

- [ ] **Step 1: 写失败测试**

覆盖首次创建目录、索引、两局隔离、活动 ID、并发写、删除、flush、损坏索引重建和损坏 session 隔离。

索引断言：

```ts
expect(await store.list()).toEqual([
  expect.objectContaining({ gameId: "game_1", name: "阵容一" }),
]);
expect(await store.getActiveId()).toBe("game_1");
```

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/currency-war/games/currency-war-game-store.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现原子 Store**

目录固定为传入 `rootDir` 下的 `index.json/sessions/corrupt`。复用 `writeFileAtomically`，索引和每个 game session 分别排队。ID 仅允许 `/^[A-Za-z0-9_.-]+$/`。

- [ ] **Step 4: 验证并提交**

Run: `npx vitest run tests/currency-war/games/currency-war-game-store.test.ts`

Expected: PASS。

Commit: `feat: persist independent currency war games`

---

### Task 3: 实现多对局 Service 与总结

**Files:**
- Create: `src/main/currency-war/games/currency-war-game-service.ts`
- Create: `src/main/currency-war/games/currency-war-game-summary.ts`
- Create: `tests/currency-war/games/currency-war-game-service.test.ts`
- Create: `tests/currency-war/games/currency-war-game-summary.test.ts`

**Interfaces:**
- Produces: `CurrencyWarGameService` 的 list/get/create/setActive/rename/update/reset/remove/validate/getEditorOptions/summarize/flush。

- [ ] **Step 1: 写 Service 失败测试**

覆盖：

```ts
expect((await service.initialize()).games).toHaveLength(1);
for (let index = 1; index < 10; index++) await service.create();
await expect(service.create()).rejects.toThrow("CURRENCY_WAR_GAME_LIMIT_REACHED");
```

并测试重命名、切换、删除当前、删除最后一局自动创建默认局、非法更新不落盘。

- [ ] **Step 2: 写总结失败测试**

构造包含 5 费银狼、2 件库存和 1 件分配的状态，断言总结包含：

```text
1号 银狼LV.999，5费，2星，前台
某装备 × 2
1号 银狼LV.999：某装备 × 1
```

- [ ] **Step 3: 运行并确认失败**

Run: `npx vitest run tests/currency-war/games`

Expected: FAIL，Service 和 Summary 不存在。

- [ ] **Step 4: 实现 Service**

固定：

```ts
export const MAX_CURRENCY_WAR_GAMES = 10;
```

名称 trim 后必须为 1 至 60 个字符。所有返回值深拷贝。`update` 合并 patch、校验、成功后保存。

- [ ] **Step 5: 实现 SummaryBuilder**

按规格固定顺序生成 Markdown；通过 `gameId` 调用前必须读取已保存状态和校验结果。

- [ ] **Step 6: 验证并提交**

Run: `npx vitest run tests/currency-war/games tests/currency-war/state`

Expected: PASS。

Commit: `feat: manage and summarize currency war games`

---

### Task 4: 替换 IPC、preload 与主进程装配

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/electron-api.ts`
- Create: `src/main/app/register-currency-war-games-ipc.ts`
- Delete: `src/main/app/register-currency-war-state-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/app/main.ts`
- Create: `tests/main/register-currency-war-games-ipc.test.ts`
- Delete: `tests/main/register-currency-war-state-ipc.test.ts`
- Modify: `tests/shared/ipc-channels.test.ts`
- Modify: `tests/shared/electron-api.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarGameService`
- Produces: `window.cyrene.currencyWarGames`

- [ ] **Step 1: 写失败测试**

断言 11 个固定 Channel，所有 ID/name/patch payload 使用精确对象检查；list/create/options 不接收 payload。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/main/register-currency-war-games-ipc.test.ts tests/shared`

Expected: FAIL，新 namespace 不存在。

- [ ] **Step 3: 实现共享 API、Handler 和 preload**

删除 `currencyWarState`，增加 `currencyWarGames`。Handler 只验证边界并调用 Service，不复制业务规则。

- [ ] **Step 4: 修改 main 装配**

使用：

```ts
rootDir: join(userData, "currency-war", "games")
```

初始化独立 Service、注册新 IPC、退出时 flush。Conversation Service 不再接收 GameState 删除回调。

- [ ] **Step 5: 验证并提交**

Run: `npx vitest run tests/main tests/shared tests/conversations/conversation-service.test.ts`

Run: `npm run build:electron`

Expected: PASS。

Commit: `feat: expose independent currency war games api`

---

### Task 5: 独立对局 Renderer 管理与数据编辑

**Files:**
- Create: `src/renderer/chat/currency-war-games-view-model.ts`
- Create: `src/renderer/chat/currency-war-games-view.ts`
- Modify: `src/renderer/chat/currency-war-state-view-model.ts`
- Modify: `src/renderer/chat/currency-war-state-view.ts`
- Modify: `src/renderer/chat/currency-war-character-editor.ts`
- Modify: `src/renderer/chat/currency-war-equipment-editor.ts`
- Modify: `src/renderer/chat/main.ts`
- Modify: `src/renderer/chat/style.css`
- Create: `tests/renderer/currency-war-games-view-model.test.ts`
- Create: `tests/renderer/currency-war-games-view.test.ts`
- Modify: `tests/renderer/currency-war-character-editor.test.ts`
- Modify: `tests/renderer/currency-war-equipment-editor.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarGamesApi`
- Produces: 对局列表管理、结构化编辑、总结与复制。

- [ ] **Step 1: 写 ViewModel 失败测试**

覆盖初始化、切换前保存、保存失败阻止切换、新建后激活、10 局禁用、重命名、删除后切换和总结。

- [ ] **Step 2: 写编辑器失败测试**

证明：

- 选择银狼 5 费后重新渲染仍是 5；
- 商店星级选项只有 1/2；
- 新库存 quantity 为 1；
- 分配数量更新；
- 不渲染特殊资源。

- [ ] **Step 3: 运行并确认失败**

Run: `npx vitest run tests/renderer/currency-war-*`

Expected: FAIL，新管理模块不存在或旧 API 仍绑定 Conversation。

- [ ] **Step 4: 实现独立管理栏**

顶部渲染选择器、新建、重命名、删除、总结按钮。达到上限时禁用新建。总结结果显示在只读 textarea，并通过可注入 `copyText` 调用剪贴板。

- [ ] **Step 5: 修改字段编辑器**

角色和商店读取持久化 `cost`。商店星级只渲染 1/2。库存与分配增加 quantity 数字输入。删除特殊资源区域。

- [ ] **Step 6: 从 main.ts 删除 Conversation 联动**

`openConversation/createConversation/renameConversation/removeConversation` 都不调用对局控制器。点击“对局”导航时由独立 Controller 初始化或刷新。

- [ ] **Step 7: 验证并提交**

Run: `npx vitest run tests/renderer`

Run: `npm run build:renderer`

Expected: PASS。

Commit: `feat: add independent currency war games workspace`

---

### Task 6: 删除 Chat 自动注入和旧单状态模块

**Files:**
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `src/main/app/main.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`
- Delete: `src/main/currency-war/state/game-state-store.ts`
- Delete: `src/main/currency-war/state/game-state-service.ts`
- Delete: `tests/currency-war/state/game-state-store.test.ts`
- Delete: `tests/currency-war/state/game-state-service.test.ts`

**Interfaces:**
- Produces: Chat 与独立对局之间无隐式数据流。

- [ ] **Step 1: 写/修改失败测试**

删除 `currencyWarStateService` 测试依赖，并断言系统 prompt 不包含“当前货币战争对局”。Conversation 删除测试不再期待关联资源清理。

- [ ] **Step 2: 运行并确认失败**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts tests/conversations/conversation-service.test.ts`

Expected: FAIL，旧依赖仍被调用。

- [ ] **Step 3: 删除旧注入和模块**

从 `RegisterChatIpcDeps`、prompt parts、main 装配和 Conversation `onRemoved` 中删除旧关系。确认新 Games Service 不依赖 Chat。

- [ ] **Step 4: 验证并提交**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts tests/conversations tests/currency-war`

Expected: PASS。

Commit: `refactor: decouple currency war games from chat`

---

### Task 7: 文档与完整验收

**Files:**
- Modify: `README.md`
- Modify: `docs/learning/13-currency-war-game-state.md`

**Interfaces:**
- Produces: 独立多对局的中文使用与学习说明。

- [ ] **Step 1: 更新文档**

删除“每个 Conversation 一份 GameState”和自动注入说明；增加独立对局、10 局上限、总结复制、费用/星级/装备数量规则和测试步骤。

- [ ] **Step 2: 完整验证**

Run: `npm test`

Expected: 全部测试通过。

Run: `npm run build`

Expected: Electron 与 Renderer 构建成功。

Run: `npm run currency-war:data-check`

Expected: 4.4 数据检查退出码 0。

- [ ] **Step 3: Electron 人工验收**

Run: `npm run dev:electron`

验证：

1. 银狼 LV.999 可保持 3/4/5 费；
2. 其他 4/5 费角色可正常选择；
3. 商店没有 3 星；
4. level 小于上阵人数仍能保存；
5. 没有特殊资源；
6. 装备库存和分配可填数量；
7. 可创建 10 局，第 11 局被拒绝；
8. Chat Conversation 切换不改变当前对局；
9. 总结可生成并复制；
10. Chat system prompt 不自动包含 GameState。

- [ ] **Step 4: 清洁检查并提交**

Run: `git diff --check && git status --short`

Expected: 无缓存、dist、日志或用户对局文件。

Commit: `docs: explain independent currency war games`

---

## Plan Review Checklist

- [ ] 独立 Game ID、索引和 10 局限制均有实现任务。
- [ ] 角色费用、星级和装备数量规则均有测试。
- [ ] 特殊资源和等级人数限制被删除。
- [ ] Chat 自动注入与 Conversation 删除关联被删除。
- [ ] 总结与复制不依赖 LLM。
- [ ] Renderer 不读取数据文件。
- [ ] 旧 Conversation GameState 不加载也不删除。
