# 货币战争结构化对局编辑器设计

## 目标

把当前依赖文本格式的阵容、商店和装备录入，改成适合实际使用的结构化编辑器。

编辑器必须满足：

- 一个 Chat Conversation 对应一份 GameState；
- 当前聊天会话决定“对局”页正在查看和编辑的状态；
- 角色按“费用 → 角色 → 当前星级”选择；
- 每个阵容角色显示序号，装备通过角色序号分配；
- 删除不需要的商店锁定和顾问解锁复选框。

## 角色数据来源

Renderer 不直接读取 `data/currency-war/runtime/4.4/characters.json`，也不硬编码角色名单。

主进程从现有 `CurrencyWarRuntime.catalog` 读取角色数据，并通过只读 IPC 返回编辑器选项：

```ts
interface CurrencyWarCharacterOption {
  name: string;
  costs: number[];
  advisor: boolean;
}

interface CurrencyWarEditorOptions {
  characters: CurrencyWarCharacterOption[];
  equipment: string[];
}
```

角色原始 `cost` 可能是单个数字或数字数组，统一转换成 `costs: number[]`。Renderer 根据用户选择的费用过滤角色下拉框。

新增接口：

```ts
window.cyrene.currencyWarState.getEditorOptions()
```

对应只读 Channel：

```text
currency-war:state:get-editor-options
```

## 阵容编辑器

上阵和备战席不再使用文本框，每个角色使用一行结构化控件。

### 上阵角色行

```text
序号 | 费用 | 角色 | 星级 | 前台/后台 | 删除
```

### 备战席角色行

```text
序号 | 费用 | 角色 | 星级 | 删除
```

选择顺序：

1. 选择费用；
2. 角色下拉框只显示该费用对应的角色；
3. 选择角色；
4. 选择当前星级；
5. 上阵角色选择前台或后台。

新增角色时默认：

- 费用：第一个可用费用；
- 角色：该费用下第一个角色；
- 星级：1 星；
- 上阵位置：前台。

每个角色仍使用 `instanceId` 作为后端稳定身份。界面序号只是易读编号：

- 先按上阵列表顺序编号；
- 再按备战席顺序继续编号；
- 装备内部保存 `characterInstanceId`，不保存显示序号。

因此，角色移动或重新排序后，装备关系不会错误地指向其他角色。

## 商店编辑器

商店每个槽位使用结构化选择：

```text
槽位 | 费用 | 角色 | 星级 | 删除
```

数据结构为 `CurrencyWarShopSlot` 增加：

```ts
star: number;
```

旧状态迁移时，已有商店角色默认记为 1 星。空槽位不需要保留为特殊行，用户可以直接删除槽位或新增槽位。

删除 `shop.locked` 的界面控件。为兼容现有 schema，后端字段暂时保留且始终写为 `false`，后续统一 schema 迁移时再删除，避免本次改动扩大到无关数据迁移。

## 装备与分配

库存装备改成结构化装备行，每行选择一个装备名称。

装备分配行：

```text
角色序号及角色名 | 装备 | 删除
```

角色选择器显示：

```text
1号 黑塔（2星）
2号 翡翠（1星）
```

保存时转换为：

```ts
{
  characterInstanceId: "...",
  equipmentInstanceId: "..."
}
```

同一件装备不能分给多个角色，每个角色最多装备 3 件；继续使用现有 Service 校验。

## 顾问

删除“已解锁顾问”复选框。

原“顾问名称”改成“已解锁顾问”，使用角色下拉框，只显示角色数据中 `advisor` 可用的角色。

规则：

- 未选择：`advisorState = { unlocked: false, name: null }`
- 选择角色：`advisorState = { unlocked: true, name: 角色名 }`

用户不再分别维护 `unlocked` 和 `name`，避免两个字段互相矛盾。

## Conversation 与 GameState 绑定

保持一个 Conversation 对应一份 GameState：

```text
Conversation ID → game-states/<conversationId>.json
```

交互流程：

1. 用户在 Chat 中选择 Conversation；
2. `openConversation(id)` 保存上一会话尚未写入的 GameState；
3. Chat 加载该 Conversation 的消息；
4. 对局控制器加载同一个 ID 的 GameState；
5. “对局”页标题显示当前 Conversation 标题；
6. Agent 请求使用同一个 Conversation ID 获取 GameState 上下文。

“对局”页不增加独立的会话选择器，避免聊天和对局指向不同会话。

## 文件职责

- `src/shared/currency-war-api-types.ts`
  - 增加商店星级和编辑器选项类型。
- `src/main/currency-war/state/game-state-service.ts`
  - 从 Catalog 生成只读编辑器选项。
- `src/main/app/register-currency-war-state-ipc.ts`
  - 注册编辑器选项 Channel。
- `src/preload/index.ts`
  - 暴露 `getEditorOptions()`。
- `src/renderer/chat/currency-war-state-view-model.ts`
  - 继续处理状态加载、防抖保存和会话切换。
- `src/renderer/chat/currency-war-state-view.ts`
  - 拆分并渲染阵容、商店、装备和顾问结构化控件。
- `src/renderer/chat/main.ts`
  - 把当前 Conversation ID 和标题传给对局控制器。

如果 `currency-war-state-view.ts` 因结构化控件继续增长，应拆为：

- `currency-war-character-editor.ts`
- `currency-war-shop-editor.ts`
- `currency-war-equipment-editor.ts`

避免所有表单逻辑重新堆回一个文件。

## 错误处理

- 编辑器选项加载失败：显示“角色数据不可用”，保留基础经济字段，不允许新增角色。
- 某个已保存角色不在当前选项中：保留并显示该名称，同时给出校验提醒，不能静默删除。
- 切换费用后原角色不属于该费用：自动选择该费用下第一个角色。
- 无角色可选：禁用角色选择器。
- 删除角色后：同时删除指向该角色的装备分配。
- 删除库存装备后：同时删除该装备对应的分配。
- 切换 Conversation 前继续 `flush()`，保存失败时显示错误，不把旧会话状态渲染到新会话。

## 测试范围

### 共享与主进程

- 商店槽位星级默认值和旧数据迁移；
- Catalog 单费用、多费用角色转换；
- 编辑器选项 IPC 和 preload；
- 顾问下拉只包含可作为顾问的角色。

### Renderer

- 费用筛选角色；
- 费用变化后修正不匹配角色；
- 阵容序号连续且上阵优先；
- 角色、库存删除时清理无效装备分配；
- 商店结构化槽位保存；
- 顾问名称自动推导 `unlocked`；
- Conversation 切换时先保存旧状态，再显示新状态；
- 标题显示当前 Conversation。

### 完整验证

- 全量 Vitest；
- Electron 与 Renderer 构建；
- Electron 手动测试两个 Conversation 的不同阵容；
- 对话 Agent 读取当前聊天框对应的阵容，而不是上一会话状态。
