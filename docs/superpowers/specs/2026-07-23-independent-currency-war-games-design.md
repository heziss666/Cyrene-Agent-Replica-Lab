# 独立货币战争对局管理设计

## 目标

将 GameState 从 Conversation 生命周期中完全拆出，建立独立的多对局管理系统。

用户可以：

- 创建、切换、重命名和删除对局；
- 同时保存最多 10 份对局；
- 在结构化界面中编辑当前对局；
- 生成当前对局的完整文本总结；
- 一键复制总结并粘贴到任意聊天会话。

Chat Agent 不再自动读取 GameState，对局与 Conversation 不保存任何关联。

## 核心架构

```text
对局页面
  ↓
Game Workspace Controller
  ↓ window.cyrene.currencyWarGames
preload
  ↓ IPC
CurrencyWarGameService
  ├─ GameStore：索引、状态文件、原子写入
  ├─ Validator：游戏规则校验
  ├─ EditorOptions：4.4 角色与装备选项
  └─ SummaryBuilder：确定性文本总结
```

不再使用：

```text
Conversation ID → GameState
```

改为：

```text
Game ID → GameState
```

## 独立对局身份

GameState 将：

```ts
conversationId: string;
```

改为：

```ts
gameId: string;
name: string;
```

每份对局拥有独立 ID。名称由用户修改，不作为文件名。

默认新对局：

```ts
{
  gameId: "game_<uuid>",
  name: "新对局",
  nodeId: "1-1",
  ...
}
```

对局数量限制固定为：

```ts
MAX_CURRENCY_WAR_GAMES = 10;
```

达到限制后：

- 新建按钮禁用；
- Service 拒绝额外创建，错误码为 `CURRENCY_WAR_GAME_LIMIT_REACHED`；
- 删除一份后可以继续创建。

系统至少保留一份对局。删除最后一份时，Service 自动创建新的默认对局。

## 存储结构

```text
userData/
  currency-war/
    games/
      index.json
      sessions/
        game_xxx.json
        game_yyy.json
```

索引文件：

```ts
interface CurrencyWarGameIndex {
  schemaVersion: 1;
  activeGameId: string;
  games: Array<{
    gameId: string;
    name: string;
    nodeId: string;
    status: "active" | "won" | "lost";
    createdAt: string;
    updatedAt: string;
  }>;
}
```

Store 继续使用原子写入和每个 `gameId` 的串行写队列。

旧目录：

```text
userData/currency-war/game-states/
```

不再加载，也不自动删除。这样不会误删用户旧测试数据，同时避免为了临时数据引入复杂迁移。

## 对局管理 API

共享 API：

```ts
interface CurrencyWarGamesApi {
  list(): Promise<CurrencyWarGameListResult>;
  get(gameId: string): Promise<CurrencyWarGameState>;
  create(): Promise<CurrencyWarGameState>;
  setActive(gameId: string): Promise<CurrencyWarGameState>;
  rename(gameId: string, name: string): Promise<CurrencyWarGameState>;
  update(gameId: string, patch: CurrencyWarStatePatch): Promise<CurrencyWarStateUpdateResult>;
  reset(gameId: string): Promise<CurrencyWarGameState>;
  remove(gameId: string): Promise<CurrencyWarGameListResult>;
  validate(gameId: string): Promise<CurrencyWarStateValidationResult>;
  getEditorOptions(): Promise<CurrencyWarEditorOptions>;
  summarize(gameId: string): Promise<{ text: string }>;
}
```

IPC namespace 从 `currencyWarState` 调整为 `currencyWarGames`，Channel 使用：

```text
currency-war:games:list
currency-war:games:get
currency-war:games:create
currency-war:games:set-active
currency-war:games:rename
currency-war:games:update
currency-war:games:reset
currency-war:games:remove
currency-war:games:validate
currency-war:games:get-editor-options
currency-war:games:summarize
```

## 角色费用

角色实例和商店槽位必须持久化当前费用：

```ts
interface CurrencyWarCharacterInstance {
  instanceId: string;
  characterName: string;
  cost: number;
  star: number;
  position: "front" | "back" | "bench";
}

interface CurrencyWarShopSlot {
  slot: number;
  characterName: string | null;
  cost: number;
  star: 1 | 2;
}
```

银狼 LV.999 的选项为：

```ts
costs: [3, 4, 5]
```

同一个角色可以按 3、4 或 5 费保存。界面重新渲染时直接读取实例的 `cost`，不再取角色的最低费用。

角色费用校验：

- 当前费用必须存在于该角色的 `costs`；
- 普通角色不能被保存为不属于它的费用；
- 费用筛选支持数据中出现的全部费用，不写死为 1 至 3。

## 星级规则

阵容角色：

```text
1星 / 2星 / 3星
```

商店角色：

```text
1星 / 2星
```

Validator 分别检查：

- `board/bench.star` 必须在 1 至 3；
- `shop.slots.star` 必须在 1 至 2。

## 取消等级人数限制

删除校验：

```text
BOARD_EXCEEDS_LEVEL
```

`level` 仍作为对局信息保存，但不再用于限制上阵人数。上阵容量可能受到其他游戏机制影响，当前系统不做推断。

## 删除特殊资源

从以下位置移除 `specialResources`：

- `CurrencyWarGameState`
- `CurrencyWarStatePatch`
- 默认工厂
- 迁移结果
- Validator
- Renderer
- Agent/总结文本
- 测试和学习文档

读取旧 schema 时允许忽略该字段，避免旧文件导致解析错误。

## 装备库存数量

库存改为堆叠数量：

```ts
interface CurrencyWarInventoryItem {
  instanceId: string;
  equipmentName: string;
  quantity: number;
}
```

默认：

```ts
quantity: 1
```

装备分配增加数量：

```ts
interface CurrencyWarEquipmentAssignment {
  equipmentInstanceId: string;
  characterInstanceId: string;
  quantity: number;
}
```

规则：

- 数量必须为正整数；
- 同一库存项的分配数量总和不能超过库存数量；
- 一个角色装备数量总和不能超过 3；
- 删除库存项时删除其全部分配；
- 删除角色时删除其全部分配；
- 降低库存数量导致已分配数量超限时，Service 拒绝保存并显示校验问题。

界面中库存行：

```text
序号 | 装备 | 数量 | 删除
```

分配行：

```text
角色序号及名称 | 装备 | 数量 | 删除
```

## 对局页面

对局页面顶部增加管理栏：

```text
[对局选择器] [新建] [重命名] [删除] [总结当前对局]
```

行为：

- 页面首次打开时加载 Store 的 `activeGameId`；
- 切换对局前保存当前编辑；
- 保存失败时阻止切换；
- 新建成功后自动切换到新对局；
- 达到 10 份时禁用新建；
- 删除当前对局后切换到 Service 返回的 `activeGameId`；
- 对局选择不影响 Chat 当前 Conversation；
- Chat Conversation 切换也不影响当前对局。

原有 Conversation 侧栏和 `openConversation()` 不再调用对局 Controller。

## 对局总结

`SummaryBuilder` 在主进程中根据已保存 GameState 生成确定性文本，不调用 LLM。

内容顺序固定：

1. 游戏版本、模式、难度和状态；
2. 当前节点及下一节点；
3. 生命、经济、等级、经验和连胜；
4. 上阵角色；
5. 备战席；
6. 商店；
7. 装备库存；
8. 装备分配；
9. 投资环境与策略；
10. 已解锁顾问；
11. 备注；
12. 当前校验提醒。

示例：

```text
# 货币战争当前对局：五费阵容测试

版本：4.4
模式：标准博弈
难度：最高
节点：2-4（战斗）
下一节点：2-5

生命：72
金币：31
等级：7
经验：12

## 上阵角色
1号 银狼LV.999，5费，2星，前台

## 装备库存
某装备 × 2

## 装备分配
1号 银狼LV.999：某装备 × 1
```

点击“总结当前对局”后：

- 当前未保存修改先执行 `flush()`；
- 调用 `summarize(activeGameId)`；
- 在只读文本区域显示总结；
- 显示“复制总结”按钮。

复制使用 Renderer 的 `navigator.clipboard.writeText(text)`。复制成功显示“已复制”，失败时保留文本供手动复制。

## 移除 Chat 自动注入

删除：

```ts
currencyWarStateService.getAgentContext(conversationId)
```

以及 `registerChatIpc` 的 `currencyWarStateService` 依赖。

系统提示词不再自动包含任何 GameState。用户需要把总结文本粘贴到需要使用的 Conversation。

Conversation 删除流程也不再调用 GameState 删除。

## 文件边界

- `src/shared/currency-war-api-types.ts`
  - 独立对局、列表、库存数量和 API 协议。
- `src/main/currency-war/games/currency-war-game-store.ts`
  - 索引、状态文件和写队列。
- `src/main/currency-war/games/currency-war-game-service.ts`
  - 多对局生命周期、上限和业务操作。
- `src/main/currency-war/games/currency-war-game-summary.ts`
  - 确定性总结。
- `src/main/app/register-currency-war-games-ipc.ts`
  - 对局管理 IPC。
- `src/renderer/chat/currency-war-games-view-model.ts`
  - 对局列表、当前选择、保存切换和总结状态。
- `src/renderer/chat/currency-war-state-view.ts`
  - 当前对局结构化字段编辑。
- `src/renderer/chat/currency-war-games-view.ts`
  - 对局管理栏、总结和复制。

旧的单 GameState Store/Service 在新模块通过测试后删除，避免两个运行时同时生效。

## 错误处理

- 达到 10 局：`CURRENCY_WAR_GAME_LIMIT_REACHED`
- 对局不存在：`CURRENCY_WAR_GAME_NOT_FOUND`
- 非法名称：`CURRENCY_WAR_GAME_NAME_INVALID`
- 非法 ID：`CURRENCY_WAR_GAME_ID_INVALID`
- 当前对局保存失败：阻止切换并保留本地编辑
- 总结前保存失败：不生成旧状态总结
- 剪贴板失败：显示错误，文本仍可手动复制
- 索引损坏：从合法 session 文件重建索引
- 单个 session 损坏：隔离该文件，其他对局继续可用

## 测试范围

### 协议与规则

- 银狼 LV.999 可保存为 3、4、5 费；
- 普通角色拒绝错误费用；
- 阵容最高 3 星；
- 商店最高 2 星；
- 不再出现 `BOARD_EXCEEDS_LEVEL`；
- 不再存在 `specialResources`；
- 装备数量与分配总量校验。

### Store 与 Service

- 首次启动创建默认对局；
- 多对局隔离；
- 最多 10 份；
- 新建、重命名、切换、删除；
- 删除最后一份后创建默认对局；
- 索引和 session 原子写入；
- 损坏索引重建。

### Renderer

- 当前费用重新渲染后保持 4 或 5；
- 商店没有 3 星选项；
- 库存数量默认 1；
- 对局选择与 Conversation 切换互不影响；
- 保存失败阻止对局切换；
- 总结显示和复制状态。

### Chat

- system prompt 不再包含 GameState；
- Conversation 删除不删除任何独立对局；
- 用户粘贴总结后按普通用户消息处理。

### 完整验收

- 全量 Vitest；
- Electron 和 Renderer 构建；
- 4.4 数据检查；
- Electron 中创建 10 份并验证第 11 份被拒绝；
- 切换 Chat Conversation 时当前对局不变；
- 复制总结并粘贴到任意聊天框。
