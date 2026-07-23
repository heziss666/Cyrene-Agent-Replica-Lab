# 货币战争 GameState 完整设计

## 1. 目标与范围

本阶段完成货币战争 GameState 的后端模型、本地持久化、Electron 手动录入界面，以及 Chat Agent 的状态读取入口。

产品边界固定为：

- 仅支持 4.4 版本货币战争。
- 仅支持标准博弈。
- 默认且仅支持最高难度。
- 每个 Conversation 最多绑定一份 GameState。
- 第一版由用户手动录入对局状态。
- 本阶段不实现截图识别和高级阵容推荐。

## 2. 使用流程

1. 用户创建或切换 Conversation。
2. 进入“对局”工作区。
3. 若当前 Conversation 没有 GameState，点击“开始新对局”。
4. 用户录入节点、经济、阵容、商店、装备、投资环境、投资策略和专家顾问状态。
5. 页面修改后自动保存。
6. 用户返回 Chat 提问时，后端读取当前 Conversation 对应的 GameState。
7. Agent 可以使用结构化状态和确定性规则回答局面问题。
8. 对局结束后状态继续保留，供复盘使用；开始新对局时只重置 GameState，不删除聊天记录。

## 3. GameState 数据模型

GameState 顶层包含：

- `schemaVersion`：状态文件格式版本。
- `gameVersion`：固定为 `4.4`。
- `conversationId`：所属 Conversation。
- `status`：`active`、`won` 或 `lost`。
- `mode`：固定为 `standard`。
- `difficulty`：固定为 `highest`。
- `nodeId`：当前固定节点，例如 `2-4`。
- `teamHealth`：当前小队生命值。
- `gold`：当前金币。
- `level`：当前等级。
- `experience`：当前经验。
- `winStreak`：当前连胜数；不知道时允许为 `null`。
- `board`：前台和后台角色实例。
- `bench`：备战席角色实例。
- `shop`：当前商店槽位。
- `inventory`：未装备物品。
- `equipmentAssignments`：角色装备关系。
- `investmentEnvironment`：当前投资环境。
- `investmentStrategies`：已选择的投资策略及其位面。
- `advisorState`：专家顾问解锁状态和来源。
- `specialResources`：免费刷新、拆装次数等特殊资源。
- `notes`：用户补充的局面说明。
- `createdAt`、`updatedAt`：创建和更新时间。

### 3.1 角色实例

同名角色可以同时存在，因此不能只用角色名称作为实例标识。每个角色实例包含：

- `instanceId`：本局内生成的短 ID。
- `characterName`：对应五份实体数据中的中文名。
- `star`：当前星级。
- `position`：`front`、`back` 或 `bench`。

场上与备战席使用同一种角色实例结构，避免移动角色时丢失星级和装备关联。

### 3.2 商店

商店按槽位保存：

- `slot`：从 1 开始。
- `characterName`：角色中文名；空槽位为 `null`。
- `locked`：整个商店是否锁定保存在 ShopState 顶层。

### 3.3 装备

装备关系单独保存，避免把同一装备数据复制到角色对象中：

- 未穿戴装备进入 `inventory`。
- 已穿戴装备进入 `equipmentAssignments`。
- Assignment 引用 `characterInstanceId`，从而能区分同名角色实例。

## 4. 节点与派生状态

用户只录入 `nodeId`。节点类型、位面、节点序号、下一节点和节点间事件都由现有固定节点模块计算。

固定规则包括：

- 开局先选择投资环境。
- `1-2` 后选择第一位面投资策略。
- `2-1` 后选择第二位面投资策略。
- `3-1` 后选择第三位面投资策略。
- `1-9`、`2-7`、`3-7` 为首领节点。

这些派生字段不重复写入持久化文件，避免状态与节点表不一致。

## 5. 校验策略

校验分为三层：

### 5.1 格式校验

检查数字范围、必填字段、枚举值、重复实例 ID 和装备引用。

### 5.2 实体引用校验

角色、装备、投资环境和投资策略必须存在于当前 4.4 实体目录中。

### 5.3 游戏规则校验

检查：

- 仅允许标准博弈与最高难度。
- 节点编号必须属于固定节点序列。
- 角色星级和站位合法。
- 场上人数不能超过当前等级。
- 每个角色最多装备三件物品。
- 装备 Assignment 必须指向现存角色实例。
- 已选择策略的位面和当前进度不能明显冲突。

校验错误返回稳定错误码和字段路径，前端负责显示中文提示。

## 6. 持久化设计

新增 `CurrencyWarGameStateStore`，职责仅限于 GameState 的读取和原子写入。

建议存储目录：

```text
<应用数据目录>/currency-war/game-states/
  <conversation-id>.json
```

行为规则：

- Conversation 没有文件时返回 `null`。
- 创建新对局时写入默认状态。
- 自动保存使用串行写队列，避免连续输入产生并发覆盖。
- 写入采用临时文件加原子替换。
- 删除 Conversation 时同步删除对应 GameState。
- 旧版状态通过 `schemaVersion` 执行迁移。

## 7. 后端服务与 IPC

新增 `CurrencyWarGameStateService` 作为 Store 与界面之间的业务层，提供：

- `get(conversationId)`
- `create(conversationId)`
- `update(conversationId, patch)`
- `reset(conversationId)`
- `validate(conversationId)`
- `getAgentContext(conversationId)`

IPC Channel：

- `currency-war:state:get`
- `currency-war:state:create`
- `currency-war:state:update`
- `currency-war:state:reset`
- `currency-war:state:validate`

Preload 只暴露受限的 `window.cyrene.currencyWarState` API，Renderer 不能直接访问文件系统。

## 8. Electron 界面

左侧主导航新增“对局”入口。页面包含：

### 8.1 顶部状态

- 当前 Conversation 名称。
- 自动保存状态：已保存、保存中、保存失败。
- 开始新对局按钮。
- 当前节点、节点类型、下一节点。

### 8.2 进度与经济

- 当前节点选择。
- 小队生命值。
- 金币、等级、经验、连胜。
- 自动显示当前利息和通关职级区间。

### 8.3 阵容

- 前台、后台和备战席分区。
- 搜索现有角色并添加。
- 调整星级和位置。
- 删除或移动角色实例。
- 显示人数上限和站位错误。

### 8.4 商店

- 按槽位选择角色。
- 商店锁定开关。
- 显示当前等级各费用刷新概率。

### 8.5 装备

- 未装备物品列表。
- 为具体角色实例分配装备。
- 检查每角色三件上限。

### 8.6 投资与顾问

- 选择投资环境。
- 分别录入三个位置的投资策略。
- 记录专家顾问是否解锁、已解锁名单和解锁来源。

### 8.7 补充信息

- 特殊资源。
- 自由备注。
- 当前校验问题列表。

## 9. 自动保存

Renderer 本地维护正在编辑的草稿：

1. 用户修改字段。
2. 立即更新界面。
3. 经过短暂防抖后发送完整状态或受控 Patch。
4. Main 校验并写入。
5. 成功后显示“已保存”。
6. 失败时保留草稿，显示错误并允许重试。

切换 Conversation 前等待当前保存完成，避免状态写到错误会话。

## 10. Agent 接入

Chat 后端在每次运行 Agent 前读取当前 Conversation 的 GameState，生成结构化上下文：

- 当前固定节点与下一节点。
- 经济和利息。
- 场上、后台、备战席和星级。
- 商店和锁定状态。
- 装备与分配。
- 投资环境、策略和顾问。
- 校验问题和缺失信息。

本阶段只提供上下文，不把 GameState 原文永久写进 System Prompt，也不让模型直接修改状态。未来工具调用必须经过 GameStateService 校验。

## 11. 测试范围

- 类型和 Schema 测试。
- Store 原子写入、重载和隔离测试。
- 每 Conversation 独立状态测试。
- Service 创建、更新、重置和校验测试。
- IPC 参数与返回值测试。
- Preload API 类型测试。
- Renderer 状态模型与自动保存测试。
- Conversation 切换时保存/加载测试。
- Agent Context 生成测试。
- Electron 构建和现有完整测试回归。

## 12. 非目标

本阶段不实现：

- 截图识别或 OCR。
- 自动操作游戏。
- 自动推断用户没有录入的商店或阵容。
- 完整阵容评分器。
- 高级策略推荐 Skill。
- 超频博弈和其他难度。
