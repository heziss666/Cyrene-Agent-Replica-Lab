# Currency War GameState Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Cyrene Agent Electron 项目中实现“每个会话一局货币战争”的完整 GameState：可手动录入、自动保存、校验、随会话切换，并让聊天 Agent 自动读取当前对局状态。

**Architecture:** 共享层定义可序列化协议；主进程用 Store 负责 JSON 持久化、Service 负责默认值/校验/上下文；IPC + preload 提供有限能力给 Renderer；Renderer 用独立视图模型管理表单和防抖自动保存；Chat IPC 在每次请求时读取当前会话的状态并注入临时系统上下文。

**Tech Stack:** TypeScript、Electron、Vitest、原生 DOM/CSS、JSON 原子写入、现有 Currency War 4.4 数据目录与规则模块。

## Global Constraints

- 仅支持 4.4、标准博弈、最高难度；不为超频博弈保留可选 UI。
- 一个 Conversation 最多绑定一个 GameState；删除 Conversation 时同步删除状态文件。
- 状态文件放在 Electron `userData/currency-war/game-states/<conversationId>.json`。
- Renderer 不接触文件系统；所有读写都经过 preload 暴露的固定 IPC API。
- 自动保存采用防抖，并保证同一会话写入串行，避免旧请求覆盖新状态。
- 模型只能读取对局状态，第一版不能直接修改 GameState。
- 只持久化用户输入的事实；节点类型、下一节点、利息、阵容人数等派生结果实时计算。
- 每个任务遵循 TDD：先新增失败测试，确认失败，再写最小实现，最后运行相关测试。

---

## Task 1: 建立完整、唯一的共享 GameState 数据协议

**Files:**
- Create: `src/shared/currency-war-api-types.ts`
- Modify: `src/main/currency-war/state/game-state-types.ts`
- Create: `src/main/currency-war/state/game-state-factory.ts`
- Create: `src/main/currency-war/state/game-state-migrations.ts`
- Test: `tests/shared/currency-war-api-types.test.ts`
- Test: `tests/currency-war/state/game-state-factory.test.ts`
- Test: `tests/currency-war/state/game-state-migrations.test.ts`

- [ ] **Step 1: 写共享类型与默认状态的失败测试**

测试必须覆盖：

```ts
const state = createDefaultGameState("conversation-1", now);
expect(state).toMatchObject({
  schemaVersion: 1,
  gameVersion: "4.4",
  conversationId: "conversation-1",
  status: "active",
  mode: "standard",
  difficulty: "highest",
  nodeId: "1-1",
  board: [],
  bench: [],
});
expect(state.createdAt).toBe(now);
expect(state.updatedAt).toBe(now);
```

还要覆盖角色实例唯一 ID、商店槽位、装备归属、投资策略位面、顾问状态、特殊资源、备注，以及旧版最小状态迁移到 schema v1。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/shared/currency-war-api-types.test.ts tests/currency-war/state/game-state-factory.test.ts tests/currency-war/state/game-state-migrations.test.ts`

Expected: FAIL，提示模块或导出不存在。

- [ ] **Step 3: 定义共享协议**

在 `currency-war-api-types.ts` 中定义：

```ts
export interface CurrencyWarGameState {
  schemaVersion: 1;
  gameVersion: "4.4";
  conversationId: string;
  status: "active" | "won" | "lost";
  mode: "standard";
  difficulty: "highest";
  nodeId: string;
  teamHealth: number;
  gold: number;
  level: number;
  experience: number;
  winStreak: number | null;
  board: CurrencyWarCharacterInstance[];
  bench: CurrencyWarCharacterInstance[];
  shop: CurrencyWarShopState;
  inventory: CurrencyWarInventoryItem[];
  equipmentAssignments: CurrencyWarEquipmentAssignment[];
  investmentEnvironment: string | null;
  investmentStrategies: CurrencyWarInvestmentStrategySelection[];
  advisorState: CurrencyWarAdvisorState;
  specialResources: Record<string, number>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
```

同时定义 `CurrencyWarStatePatch`、校验问题、IPC 输入输出和 `CurrencyWarStateApi`。Patch 只允许业务字段，不允许修改 `schemaVersion/gameVersion/conversationId/createdAt`。

- [ ] **Step 4: 实现默认工厂、迁移和旧类型兼容**

`game-state-types.ts` 只从 shared 文件重导出类型，消除两份结构定义。迁移函数先识别 schema v1；对当前旧版无 schema 的对象补齐默认字段并保留已有数据，未知版本抛出 `GAME_STATE_SCHEMA_UNSUPPORTED`。

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run tests/shared/currency-war-api-types.test.ts tests/currency-war/state/game-state-factory.test.ts tests/currency-war/state/game-state-migrations.test.ts`

Expected: PASS。

Commit: `git commit -am "feat: define currency war game state model"`，并单独 `git add` 新文件后提交。

---

## Task 2: 将简单校验器升级为分层业务校验器

**Files:**
- Modify: `src/main/currency-war/state/game-state-validator.ts`
- Modify: `src/main/currency-war/state/game-state-completeness.ts`
- Modify: `src/main/currency-war/rules/placement-validator.ts`
- Modify: `src/main/currency-war/rules/equipment-validator.ts`
- Test: `tests/currency-war/state/game-state-validator.test.ts`
- Test: `tests/currency-war/state/game-state-completeness.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖：未知节点、负数经济、等级外上阵人数、重复 `instanceId`、不存在角色/装备/投资项、同一装备重复分配、单角色超过 3 件装备、策略位面早于固定节点、字段路径和稳定错误码。

期望问题结构：

```ts
{
  code: "BOARD_EXCEEDS_LEVEL",
  path: "board",
  severity: "error",
  message: "上阵角色数量不能超过当前等级"
}
```

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/currency-war/state`

- [ ] **Step 3: 实现三层校验**

1. 结构层：类型、整数范围、必填字段。
2. 引用层：通过 `CurrencyWarCatalog` 校验角色、装备、环境、策略名称。
3. 规则层：调用现有固定节点、站位、装备规则，并检查策略选择进度。

`validateGameState(state, catalog)` 始终返回 `{ valid, issues, node, transition }`，不因单个错误直接抛异常。`game-state-completeness.ts` 返回缺失但不一定非法的信息，用于 UI 提醒。

- [ ] **Step 4: 运行测试并提交**

Run: `npx vitest run tests/currency-war/state tests/currency-war/rules`

Expected: PASS。

Commit: `feat: validate complete currency war game state`

---

## Task 3: 实现按 Conversation 隔离的本地状态 Store

**Files:**
- Create: `src/main/currency-war/state/game-state-store.ts`
- Test: `tests/currency-war/state/game-state-store.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖初始化目录、读取不存在文件返回 `null`、保存后读取一致、两个会话相互隔离、同一会话连续写入以最后一次为准、删除、flush，以及损坏 JSON 报稳定错误。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/currency-war/state/game-state-store.test.ts`

- [ ] **Step 3: 实现 Store**

接口：

```ts
export interface CurrencyWarGameStateStore {
  initialize(): Promise<void>;
  load(conversationId: string): Promise<CurrencyWarGameState | null>;
  save(state: CurrencyWarGameState): Promise<void>;
  remove(conversationId: string): Promise<void>;
  flush(): Promise<void>;
}
```

复用 `src/main/rag/atomic-file-write.ts` 的 `writeFileAtomically`。会话 ID 先用已有 ID 规则校验，再作为文件名；每个 ID 维护独立 Promise 写队列，`flush()` 等待全部队列完成。

- [ ] **Step 4: 运行测试并提交**

Run: `npx vitest run tests/currency-war/state/game-state-store.test.ts`

Expected: PASS。

Commit: `feat: persist currency war game states`

---

## Task 4: 实现业务 Service、派生视图与 Agent 上下文

**Files:**
- Create: `src/main/currency-war/state/game-state-service.ts`
- Create: `src/main/currency-war/state/game-state-agent-context.ts`
- Test: `tests/currency-war/state/game-state-service.test.ts`
- Test: `tests/currency-war/state/game-state-agent-context.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖 `get/create/update/reset/remove/validate/flush/getAgentContext`，不存在状态时 `get` 自动创建，patch 不能篡改身份字段，非法 patch 不落盘，合法更新刷新 `updatedAt`。

Agent 上下文测试必须确认：

```text
## 当前货币战争对局
版本：4.4
模式：标准博弈 / 最高难度
节点：1-3（战斗）
下一节点：1-4
生命：...
经济：...
```

并包含阵容、备战席、商店、装备、投资、顾问、校验提醒；不包含空字段噪音。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/currency-war/state/game-state-service.test.ts tests/currency-war/state/game-state-agent-context.test.ts`

- [ ] **Step 3: 实现 Service**

依赖 Store、`CurrencyWarRuntime.catalog` 和可注入时钟。`update` 合并 patch 后完整校验，出现 error 时返回失败结果且不保存；warning 允许保存。Agent 上下文使用固定模板生成，明确告诉模型“状态只读，不得假设未录入内容”。

- [ ] **Step 4: 运行测试并提交**

Run: `npx vitest run tests/currency-war/state/game-state-service.test.ts tests/currency-war/state/game-state-agent-context.test.ts`

Expected: PASS。

Commit: `feat: add currency war game state service`

---

## Task 5: 接入主进程生命周期和 Conversation 删除

**Files:**
- Modify: `src/main/conversations/conversation-service.ts`
- Modify: `src/main/app/main.ts`
- Modify: `src/main/currency-war/data/currency-war-data-paths.ts`
- Test: `tests/conversations/conversation-service.test.ts`
- Test: `tests/main/main.test.ts`（若不存在则 Create）

- [ ] **Step 1: 写失败测试**

测试 Conversation 删除成功后调用可注入的 `onRemoved(conversationId)`；回调失败时明确返回错误，避免只删掉一半。测试关闭流程会等待 GameState `flush()`。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/conversations/conversation-service.test.ts tests/main/main.test.ts`

- [ ] **Step 3: 修改启动装配**

在 `main.ts`：

1. 加载 4.4 Currency War runtime。
2. 创建 `userData/currency-war/game-states` Store。
3. 创建 GameState Service。
4. 把 `gameStateService.remove` 作为 Conversation 删除回调。
5. 在 shutdown 中等待 `gameStateService.flush()`。

不要把 GameState 数据放入 Conversation JSON，保持生命周期关联、存储边界独立。

- [ ] **Step 4: 运行测试并提交**

Run: `npx vitest run tests/conversations/conversation-service.test.ts tests/main/main.test.ts`

Expected: PASS。

Commit: `feat: bind game state lifecycle to conversations`

---

## Task 6: 建立 GameState IPC 与 preload 安全 API

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/electron-api.ts`
- Create: `src/main/app/register-currency-war-state-ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/app/main.ts`
- Test: `tests/shared/ipc-channels.test.ts`
- Test: `tests/shared/electron-api.test.ts`
- Test: `tests/main/register-currency-war-state-ipc.test.ts`
- Test: `tests/preload/preload.test.ts`（若不存在则在现有 preload 测试文件中扩展）

- [ ] **Step 1: 写失败测试**

固定 Channel：

```ts
currencyWarState: {
  get: "currency-war:state:get",
  create: "currency-war:state:create",
  update: "currency-war:state:update",
  reset: "currency-war:state:reset",
  validate: "currency-war:state:validate",
}
```

测试 payload 必须是精确对象，未知键、空 ID、非法 patch 都在主进程拒绝。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/shared/ipc-channels.test.ts tests/shared/electron-api.test.ts tests/main/register-currency-war-state-ipc.test.ts`

- [ ] **Step 3: 实现 Handler 与 preload**

`registerCurrencyWarStateIpc` 只做输入边界验证和调用 Service，不复制业务规则。preload 暴露：

```ts
window.cyrene.currencyWarState.get(conversationId)
window.cyrene.currencyWarState.create(conversationId)
window.cyrene.currencyWarState.update(conversationId, patch)
window.cyrene.currencyWarState.reset(conversationId)
window.cyrene.currencyWarState.validate(conversationId)
```

- [ ] **Step 4: 运行测试并提交**

Run: `npx vitest run tests/shared tests/main/register-currency-war-state-ipc.test.ts`

Expected: PASS。

Commit: `feat: expose currency war state electron api`

---

## Task 7: 实现 Renderer 状态模型和可靠自动保存

**Files:**
- Create: `src/renderer/chat/currency-war-state-view-model.ts`
- Create: `src/renderer/chat/currency-war-state-view.ts`
- Test: `tests/renderer/currency-war-state-view-model.test.ts`
- Test: `tests/renderer/currency-war-state-view.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖加载状态、局部编辑、600ms 防抖保存、连续编辑只保存最新快照、保存中再次编辑会排队、切换会话前 flush、保存错误显示且保留本地编辑、reset。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/renderer/currency-war-state-view-model.test.ts tests/renderer/currency-war-state-view.test.ts`

- [ ] **Step 3: 实现视图模型**

视图模型不直接操作 DOM，接收 `CurrencyWarStateApi`、计时器和回调。内部维护：

```ts
type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
```

使用版本号或快照序号确保较早的 IPC 返回不能覆盖较新的本地编辑。

- [ ] **Step 4: 实现 DOM 渲染器**

`currency-war-state-view.ts` 负责把完整状态渲染成表单、收集变更并交给视图模型；角色、商店、装备使用重复行编辑器，但不在此文件实现持久化。

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run tests/renderer/currency-war-state-view-model.test.ts tests/renderer/currency-war-state-view.test.ts`

Expected: PASS。

Commit: `feat: add currency war state renderer model`

---

## Task 8: 加入“对局”工作区并绑定当前 Conversation

**Files:**
- Modify: `src/renderer/chat/index.html`
- Modify: `src/renderer/chat/main.ts`
- Modify: `src/renderer/chat/style.css`
- Modify: `tests/renderer/workspace-shell.test.ts`
- Test: `tests/renderer/currency-war-workspace.test.ts`

- [ ] **Step 1: 写结构和交互失败测试**

测试左侧存在“对局”入口；面板包含进度与经济、阵容、商店、装备、投资与顾问、备注与问题六区；切换 Conversation 时先 flush 旧状态再加载新状态。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/renderer/workspace-shell.test.ts tests/renderer/currency-war-workspace.test.ts`

- [ ] **Step 3: 修改 HTML 与导航**

为 `setActiveView` 增加 `"currency-war"`。添加 `currency-war-view-button` 和 `currency-war-view`，沿用当前顶部栏和侧栏，不创建第二套应用壳。

- [ ] **Step 4: 实现表单布局**

桌面端使用两列可滚动布局，小窗口降为单列。所有输入有明确 label；节点用固定序列下拉框；角色/装备/环境/策略用 4.4 数据名称候选；保存状态固定显示在面板标题区。

角色实例操作至少支持新增、删除、板凳与上阵切换、星级、前后排。商店支持槽位编辑和锁定。装备支持库存与分配。危险的“重置对局”需要确认。

- [ ] **Step 5: 在 `main.ts` 绑定会话**

`openConversation(id)` 成功后通知 GameState 视图模型加载该 ID；删除/新建/切换都不得残留上一会话状态。没有 active conversation 时禁用表单。

- [ ] **Step 6: 运行测试和构建并提交**

Run: `npx vitest run tests/renderer`

Run: `npm run build`

Expected: 全部 PASS，Electron 与 Renderer TypeScript 编译成功。

Commit: `feat: add currency war game workspace`

---

## Task 9: 每次聊天自动注入当前对局上下文

**Files:**
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `src/main/app/main.ts`
- Test: `tests/main/register-chat-ipc.test.ts`
- Test: `tests/currency-war/state/game-state-chat-integration.test.ts`

- [ ] **Step 1: 写失败测试**

持久会话发送消息时，应调用：

```ts
gameStateService.getAgentContext(conversationId)
```

并把结果加入 `promptParts`。无状态、读取失败或非持久 CLI 会话不得使聊天失败；读取失败发可诊断事件或日志，但继续运行。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts tests/currency-war/state/game-state-chat-integration.test.ts`

- [ ] **Step 3: 注入只读临时上下文**

在 `memoryContext` 之后加入 `gameStateContext`：

```ts
const promptParts = [
  personaPrompt,
  skillCatalog,
  manualSkillPrompt,
  memoryContext,
  gameStateContext,
].filter(...);
```

只对当前请求生成，不保存为 Conversation 消息，也不写入长期记忆。上下文说明状态可能不完整，模型应先指出关键缺失信息，再给建议。

- [ ] **Step 4: 运行测试并提交**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts tests/currency-war/state/game-state-chat-integration.test.ts`

Expected: PASS。

Commit: `feat: give agent current currency war context`

---

## Task 10: 端到端验证、文档与缓存检查

**Files:**
- Modify: `README.md`
- Create: `docs/learning/13-currency-war-game-state.md`
- Modify: `.gitignore`（仅在发现新运行时文件可能落入仓库时）

- [ ] **Step 1: 添加中文使用与学习文档**

说明：

1. GameState 在 Electron/IPC/preload/Renderer/Agent 之间如何流动。
2. 每个 Conversation 为什么独立。
3. 自动保存、原子写和写队列分别解决什么问题。
4. 如何手动测试创建、切换、重启恢复、删除、校验和聊天建议。
5. 运行时 JSON 的实际目录，不提交用户对局数据。

- [ ] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 所有 Vitest 测试通过。

Run: `npm run build`

Expected: Electron 与 Renderer 均构建成功。

Run: `git status --short`

Expected: 只出现本阶段预期源码、测试和文档；不得包含 `dist/`、用户状态 JSON、日志或缓存。

- [ ] **Step 3: Electron 手动验收**

Run: `npm run dev:electron`

依次验证：

1. 新建会话自动出现默认 1-1 对局。
2. 修改生命、金币、阵容，等待保存状态变为“已保存”。
3. 切到另一会话，数据独立。
4. 切回原会话，内容恢复。
5. 重启 Electron，内容仍恢复。
6. 输入非法数据时显示具体字段问题，不覆盖上一次合法状态。
7. 在聊天中询问当前节点建议，Agent 能准确复述当前状态后给建议。
8. 删除会话后，对应 GameState 文件消失。

- [ ] **Step 4: 最终提交**

Commit: `docs: explain currency war game state workflow`

最后运行 `git log -10 --oneline` 和 `git diff HEAD~10..HEAD --stat`，确认 10 个任务提交边界清晰。

---

## Plan Review Checklist

- [ ] 设计文档中的完整字段、每会话隔离、自动保存、IPC、UI、Agent 注入均有对应任务。
- [ ] 没有 TODO、占位实现、伪造数据或“以后再补”的关键路径。
- [ ] 公共类型只有 `src/shared/currency-war-api-types.ts` 一个事实来源。
- [ ] Store 不做业务校验，Service 不直接操作 DOM，Renderer 不访问文件系统。
- [ ] Conversation 删除和应用退出均覆盖 GameState 生命周期。
- [ ] Agent 上下文只读、按请求生成、不污染历史消息和长期记忆。
- [ ] 所有新增行为都有局部测试，最后还有完整测试、构建和 Electron 人工验收。
