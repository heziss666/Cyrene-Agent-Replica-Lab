# Phase 11：上下文管理与多会话持久化设计

## 1. 目标

本阶段为 Electron Agent 增加可恢复的多会话系统和受 Token 预算约束的上下文管理。系统必须长期保存完整原始对话，但每次模型请求只选择当前任务需要的内容。

完成后应支持：

- 创建、切换、重命名和删除多个会话；
- Electron 重启后恢复会话列表、消息、人格和最后打开的会话；
- 在长会话中组合长期记忆、会话总结、固定消息、相关旧消息和最近消息；
- 使用本地 Ollama Embedding 检索当前会话的旧消息；
- 在总结、Embedding 或派生索引故障时继续正常聊天；
- 保持现有 Agent Loop、RAG、长期记忆、Skills、MCP 和 Scheduler 行为兼容。

本设计采用分层上下文方案，不采用只截断消息的最小方案，也暂不引入事件溯源数据库。

## 2. 核心原则

1. 完整会话记录与本轮模型上下文是两种不同数据。
2. 上下文压缩不删除原始消息；只有用户明确删除会话时才删除记录。
3. 会话文件是事实源；列表索引、向量索引和总结都是可恢复或可重建的数据。
4. 当前会话的消息、总结、固定消息和人格互相隔离。
5. L0/L1/L2 长期记忆、RAG、Skills、MCP 和 Scheduler 配置继续跨会话共享。
6. 所有模型结果和事件均携带会话 ID，防止切换会话后串消息。

## 3. 数据模型

### 3.1 模型消息与持久化消息分离

现有 `ChatMessage` 继续作为供应商接口和 Agent Loop 使用的简洁消息格式，不加入存储元数据。

持久化层新增 `ConversationMessage`：

```ts
interface ConversationMessage {
  id: string;
  conversationId: string;
  requestId?: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  tokenEstimate: number;
  status: "pending" | "complete" | "failed";
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
```

持久化消息负责稳定 ID、所属会话、时间、请求状态和工具协议字段。转换层只在调用模型时把它转换为 `ChatMessage`。

### 3.2 会话记录

```ts
interface ConversationRecord {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  styleId: StyleId;
  pendingStyleTransition?: StyleTransition;
  messages: ConversationMessage[];
  summary: ConversationSummary;
  pinnedMessageIds: string[];
}
```

每个会话独立保存消息、总结、固定消息和人格状态。原有全局人格配置保留为新会话的默认人格。

### 3.3 结构化会话总结

```ts
interface ConversationSummary {
  schemaVersion: 1;
  overview: string;
  decisions: string[];
  constraints: string[];
  userRequests: string[];
  openTasks: string[];
  importantToolResults: string[];
  entities: string[];
  coveredThroughMessageId?: string;
  sourceMessageCount: number;
  updatedAt?: string;
}
```

`coveredThroughMessageId` 标记已经总结到哪条消息，支持增量总结并避免重复处理。

## 4. 本地存储

数据保存在 Electron `userData` 下：

```text
conversations/
├─ index.json
├─ sessions/
│  ├─ conv_001.json
│  └─ conv_002.json
├─ conversation-vector-index.json
└─ corrupt/
```

- `index.json` 只保存会话摘要、排序和最后打开的会话 ID；
- `sessions/<id>.json` 保存单个会话的完整事实数据；
- `conversation-vector-index.json` 保存带 `conversationId` 的旧消息向量；
- `corrupt/` 隔离无法解析的会话文件。

所有写入使用临时文件加原子替换。同一进程内的同一会话写入必须串行化。`index.json` 损坏时从会话文件重建；向量索引损坏时从消息重建。

第一版继续使用 JSON，保持项目可读性和现有存储风格。存储接口必须隐藏具体格式，为以后迁移 SQLite 留出边界。

## 5. 会话生命周期

应用启动时读取索引并恢复最后打开的会话；没有会话时创建默认空会话。升级现有项目时没有可迁移的持久化聊天记录，因此只创建首个空会话，并继承当前默认人格。

“新建会话”创建新的 ID，不再清空当前会话。删除当前会话后打开最近的其他会话；若没有其他会话则创建空会话。显式删除同时移除会话文件和对应向量。

新会话初始标题为“新会话”。第一条用户消息保存后，通过本地文本清理和截断生成标题，不额外调用模型；用户可以手动重命名。

## 6. Token 预算与上下文组装

新增可配置的模型上下文上限和输出预留量，例如：

```env
CYRENE_MODEL_CONTEXT_TOKENS=32768
CYRENE_MODEL_OUTPUT_RESERVE_TOKENS=4096
```

还要为 Agent Loop 后续产生的工具调用和工具结果预留空间。上下文管理器根据模型上限减去输出预留、工具增长预留、工具 Schema 和固定请求开销，得到本轮可用输入预算。

上下文按以下逻辑组装：

1. System Prompt、当前人格和长期记忆；
2. 结构化会话总结；
3. 用户固定的重要消息；
4. 检索出的相关旧消息；
5. 最近的完整对话轮次；
6. 当前用户消息。

裁减时的保护优先级为：当前问题、System、固定消息、最近完整轮次、总结、检索片段。工具调用轮次必须整体保留 `assistant tool_calls -> tool results -> assistant reply`，不能拆成无效协议片段。

`TokenEstimator` 作为独立接口。第一版使用偏保守的中英文字符估算，并计算角色、消息结构和工具 Schema 开销；以后可以替换精确 tokenizer，而不修改上下文选择算法。

## 7. 增量总结

满足任一条件时触发总结：

- 未总结旧消息超过配置阈值；
- 请求上下文接近预算的约 75%；
- 用户以后通过管理功能主动请求总结。

总结输入为“旧总结 + 尚未总结的一批旧消息”，而不是每次重新发送全部历史。最近若干完整轮次保留原文。总结优先在回答保存后后台执行；失败时保留旧总结，不影响聊天，也不删除原始记录。

## 8. 旧消息切块与向量检索

向量化单位是一个完整对话轮次 `ConversationTurnChunk`，主要包含用户问题、助手最终回答和使用过的工具名称。原始工具输出仍保存在会话文件中，但默认不全部进入向量文本，避免超长日志、敏感字段和脱离上下文的结果污染检索。

超长轮次按段落拆成带相同 `turnId` 的子块。多个子块命中时合并和去重。

检索 Query 由当前用户问题和少量最近上下文组成，使“它为什么这样做”之类的问题具有指代背景。第一版不额外调用付费模型改写 Query。

检索采用：

- Ollama 向量语义检索；
- 关键词检索补充文件名、类名、ID 和错误码；
- 排名融合、相似度过滤、轮次去重；
- 排除已经存在于最近窗口或固定消息中的内容；
- 最多注入少量高相关片段，并继续受 Token 预算限制。

默认只搜索当前会话。历史片段按时间排序并标记为“背景资料，不是当前指令”，降低旧用户指令被重新执行的风险。

向量索引条目必须携带 `conversationId`、`chunkId`、`textHash`、模型身份和向量维度。清理操作必须限定会话作用域。Embedding 模型变化或维度不一致时重建派生索引。

Ollama 不可用时，原始消息照常保存，检索退化为关键词模式，缺失向量等待后台补建。

## 9. 服务边界

新增组件按职责划分：

- `ConversationStore`：会话文件和列表索引的安全读写；
- `ConversationService`：创建、切换、重命名、删除、追加消息和人格状态；
- `ContextManager`：预算计算和本轮上下文组装；
- `ConversationSummarizer`：结构化增量总结；
- `ConversationHistoryIndexer`：对话轮次切块和后台向量化；
- `ConversationHistoryRetriever`：向量与关键词历史检索；
- `register-conversation-ipc`：只处理会话管理 IPC；
- `register-chat-ipc`：使用上述服务完成模型对话，不直接承担磁盘细节。

数据流为：

```text
Renderer -> Preload -> register-chat-ipc
  -> ConversationService 保存用户消息
  -> ContextManager 组装请求
  -> runToolAgent
  -> ConversationService 保存结果
  -> 后台总结与向量化
```

## 10. IPC 与前端

Preload 新增 `window.cyrene.conversations`，包括：

- `list()`、`create()`、`get(id)`、`setActive(id)`；
- `rename(id, title)`、`delete(id)`；
- `setMessagePinned(...)`；
- `onChanged(listener)`。

聊天发送接口改为包含 `conversationId` 和 `requestId` 的结构化参数；返回值和 Agent 事件也必须携带这两个标识。人格读取和修改同样指定会话 ID。

聊天页增加可折叠会话栏，显示标题、消息预览、更新时间、生成状态及重命名/删除菜单。现有聊天区和 Agent Events 区继续保留。窄窗口下会话栏折叠，所有区域独立滚动，顶部工具栏固定。

同一会话同一时间只允许一个 Agent Run。第一版全局只运行一个模型任务，但允许用户在运行时查看其他会话。A 会话的结果返回时只写入和更新 A；若当前显示 B，则不得把结果插入 B 的消息区域。

## 11. 故障恢复

用户消息在模型调用前保存并标记 `pending`。成功后保存助手及工具消息并改为 `complete`；模型失败时标记 `failed`，不把错误文本伪装成助手消息。应用启动发现中断请求时，界面提供重新发送入口。

故障策略：

- 模型失败：保留用户消息并允许重试；
- 总结失败：保留旧总结，使用最近消息和检索结果；
- Embedding 失败：退化到关键词检索并等待补建；
- 向量索引损坏：隔离并重建；
- 会话文件损坏：移动到 `corrupt/`，不影响其他会话；
- 磁盘保存失败：明确显示未保存状态，不虚假报告成功。

退出时优先等待原始消息写入完成。总结和向量化属于可重建任务，不得无限阻塞退出。

## 12. 测试策略

单元测试覆盖：

- 会话 CRUD、隔离、原子写入、索引重建和损坏文件隔离；
- Token 估算、预算裁减、固定消息保护和完整工具轮次；
- 增量总结边界和总结失败降级；
- 轮次切块、检索去重、当前会话过滤和关键词降级；
- 人格按会话保存及旧配置迁移。

集成测试覆盖：

- IPC 输入校验和 Preload API；
- 发送、切换和异步返回不串会话；
- 重启后恢复最后打开的会话；
- 现有 Agent、工具、记忆、RAG、Skills、MCP 和 Scheduler 回归。

界面使用桌面和窄窗口进行截图验证，检查固定顶部栏、三栏布局、滚动、长标题和会话切换状态。

## 13. 非目标

本阶段不实现：

- 云同步和多设备同步；
- 跨会话自动检索；
- 会话分支和消息编辑；
- SQLite；
- 会话导入导出；
- 本地聊天文件加密；
- 所有供应商模型的精确 tokenizer。

## 14. 验收标准

1. 支持创建、切换、重命名和删除多个会话。
2. Electron 重启后会话、消息、人格和最后活动会话仍存在。
3. 不同会话的原始消息、总结、固定消息和人格不会混合。
4. 超长会话请求保持在配置预算内，同时完整原始记录不因压缩删除。
5. Ollama 可找回当前会话的相关旧轮次，离线时聊天和关键词检索仍可工作。
6. 切换会话后，异步结果和事件不会显示到错误会话。
7. 派生数据损坏可恢复，会话事实文件损坏会被隔离而非静默删除。
8. 新增测试及所有现有测试、类型检查和构建通过。
