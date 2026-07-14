# Phase 7 完整记忆系统设计

日期：2026-07-14

## 1. 目标

在已经完成的 Phase 7A 最小长期记忆基础上，实现 Phase 7 剩余全部规划内容：

- 用户可见、可控的记忆治理界面；
- L0/L1/L2 的查看、搜索、编辑、删除、固定、启用和清空；
- 自动冲突检测、评分、排队、Resolver 和确定性应用；
- 访问强化、时间衰减、L1 过期和生命周期状态；
- 后台 Reflection、聚类压缩和稳定事实提升；
- 可重建的实体关系图；
- ConflictLog、ReflectionLog、AuditLog 和安全事件；
- Schema v1 到 v2 的可恢复迁移；
- DeepSeek、Ollama、Electron 和重启恢复的端到端验证。

Phase 7 完成后，记忆系统不再只是“自动写入和自动召回”的后台功能，而是一个具备治理、演化、压缩、审计和可视化能力的完整子系统。

## 2. 当前基础

Phase 7A 已经提供：

- `memory.json` 权威存储与原子写入；
- L0 稳定画像、L1 近期状态、L2 事件记忆；
- MemoryJudge 候选提取；
- MemoryManager 的证据、隐私、置信度和去重校验；
- L2 独立向量索引与 Ollama 检索；
- 安全记忆 Prompt；
- 后台写队列、记忆事件和退出屏障。

本设计必须在这些接口之上演进，不能绕开现有安全校验，也不能让 Resolver、Reflection 或 Compressor 直接写磁盘。

## 3. 范围边界

### 3.1 包含

Phase 7B 记忆治理：

- Schema v2；
- Memory Governance Service；
- 记忆面板；
- 自动冲突检测、评分和 Resolver；
- 冲突与审计视图。

Phase 7C 生命周期：

- accessCount、lastAccessedAt、weight；
- pinned 记忆保护；
- active、aging、archived 生命周期；
- L1 过期；
- 最近注入抑制；
- MemoryScheduler；
- Reflection 和长期事实提升。

Phase 7D 压缩与结构化：

- L2 语义聚类；
- 摘要候选与证据验证；
- 两阶段摘要提交；
- 原始记忆归档；
- 向量索引同步；
- 实体关系图。

### 3.2 不包含

- 多用户账号和云同步；
- 多进程写锁；
- 端到端磁盘加密；
- 向量数据库服务；
- 完美的自然语言事实判定；
- 删除用户原始聊天记录，因为当前项目没有持久化聊天记录；
- 用实体图代替 `memory.json`；
- 自动将低置信度推断提升为核心画像。

## 4. 核心原则

1. `memory.json` 始终是唯一权威数据源。
2. `memory-vector-index.json` 和 `entity-graph.json` 都是可重建缓存。
3. 所有模型输出都是不可信建议，必须经过确定性解析和应用器。
4. 聊天主流程不能依赖治理、Resolver、Reflection、压缩或实体图成功。
5. 自动 Resolver 不需要用户确认，但低置信度结果只能标记为 uncertain，不能覆盖事实。
6. 用户从记忆面板执行删除时必须物理删除对应记忆和证据，审计日志不得复制被删除内容。
7. 压缩不能在摘要尚未成功向量化时归档原始记忆。
8. 固定记忆不衰减、不自动归档，也不能被自动 Resolver 废弃。
9. 医疗和法律隐私可以通过记忆面板的明确编辑保存；凭据、支付信息、身份号码和精确地址仍永久拒绝。
10. 每个模块保持单一职责，避免复制源项目中由一个超大 Store 承担全部业务逻辑的结构。

## 5. 总体架构

```text
用户消息
  -> MemoryRecallService
     -> MemoryStore
     -> 生命周期过滤
     -> 最近注入抑制
     -> L2 向量召回
     -> 访问强化队列
  -> buildMemoryContext
  -> 主 Agent
  -> MemoryWriteQueue
     -> MemoryJudge
     -> MemoryManager
     -> MemoryConflictService
        -> ConflictScorer
        -> ResolverQueue
        -> MemoryResolver
        -> ResolutionApplier
     -> MemoryStore

MemoryScheduler
  -> DecayService
  -> L1ExpiryService
  -> ReflectionService
  -> MemoryCompressor
  -> EntityGraphService
  -> AuditService

Renderer Memory Panel
  -> Preload CyreneApi.memory
  -> Memory IPC handlers
  -> MemoryGovernanceService
  -> MemoryStore / MaintenanceCoordinator
```

## 6. Schema v2

### 6.1 MemoryFile

```ts
interface MemoryFileV2 {
  schemaVersion: 2;
  l0: L0Profile;
  l1: L1Profile;
  l2: L2Memory[];
  evidence: MemoryEvidence[];
  conflictLogs: ConflictLog[];
  reflectionLogs: ReflectionLog[];
  auditLogs: MemoryAuditEntry[];
  maintenance: MemoryMaintenanceState;
}
```

`memory.json` 保存权威事实、状态和日志。日志数量必须有上限：conflictLogs 200 条、reflectionLogs 200 条、auditLogs 500 条。裁剪最旧条目时不能删除仍被活动冲突或摘要引用的证据。

### 6.2 L0 和 L1

保留当前 L0/L1 的易读字段，不把每个字符串改成深层对象。

新增元数据：

```ts
interface ProfileFieldMetadata {
  updatedAt: string;
  source: "judge" | "reflection" | "user_edit" | "resolver";
  confidence?: number;
}

interface L0Profile {
  // 现有字段
  fieldMetadata?: Partial<Record<L0Field, ProfileFieldMetadata>>;
}

interface L1Profile {
  // 现有字段
  fieldMetadata?: Partial<Record<L1Field, ProfileFieldMetadata>>;
}
```

这样可以单独判断 `currentProject`、`recentGoals` 和 `recentPreferences` 是否过期，而不重构现有 Prompt 和 Manager 的主要数据形状。

### 6.3 L2Memory

```ts
type L2MemoryStatus =
  | "active"
  | "aging"
  | "archived"
  | "superseded"
  | "merged";

interface L2Memory {
  id: string;
  content: string;
  confidence: number;
  importance: "medium" | "high";
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  weight: number;
  isPinned: boolean;
  isEnabled: boolean;
  status: L2MemoryStatus;
  syncStatus: "pending_sync" | "synced" | "sync_failed";
  isSummary: boolean;
  sourceMemoryIds: string[];
  sourceSnapshots: Array<{ memoryId: string; updatedAt: string }>;
  conflictWith: string[];
  supersededBy?: string;
  mergedInto?: string;
}
```

`status` 描述生命周期，`isEnabled` 描述用户是否允许召回。二者必须分开：禁用一条 active 记忆不等于将其归档。

### 6.4 Evidence

```ts
interface MemoryEvidence {
  id: string;
  memoryId: string;
  quote: string;
  capturedAt: string;
  source: "conversation" | "user_edit" | "reflection" | "resolver";
  sourceMemoryIds: string[];
}
```

现有 L2 内嵌 evidence 在迁移时转换为独立 Evidence。摘要证据通过 sourceMemoryIds 指回原始记忆，而不是伪造新的用户原话。

### 6.5 ConflictLog

```ts
type ConflictResolutionType =
  | "unrelated"
  | "context_difference"
  | "preference_evolution"
  | "direct_conflict"
  | "uncertain";

interface ConflictLog {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  createdAt: string;
  status: "queued" | "processing" | "resolved" | "uncertain" | "failed";
  score: number;
  priority: "idle" | "normal" | "high";
  signals: ConflictSignals;
  attempts: number;
  resolutionType?: ConflictResolutionType;
  resolutionReason?: string;
  resolutionConfidence?: number;
  finishedAt?: string;
}
```

### 6.6 审计与维护状态

AuditLog 只保存操作元数据：操作类型、目标 ID/字段、来源、时间和结果，不复制记忆正文。

维护状态记录：

- 上次 decay、reflection、compression、entity graph rebuild 时间；
- 自上次维护以来成功写入的轮数；
- 当前 maintenance 是否正在运行；
- 最近一次固定错误摘要。

## 7. Schema 迁移

迁移由独立 `memory-migrations.ts` 完成：

1. 读取 v1 并完整校验旧结构；
2. 在同目录创建 `memory.pre-v2-<timestamp>.json` 备份；
3. 为每条 L2 生成稳定 evidence ID 和新增默认字段；
4. L0/L1 metadata 使用旧 updatedAt 或迁移时间；
5. 初始化日志和 maintenance；
6. 校验完整 v2；
7. 原子替换 `memory.json`；
8. 迁移失败时保留 v1，不创建半成品 v2。

迁移必须幂等。v2 文件再次启动不得重复生成 Evidence 或备份。

## 8. 记忆治理服务

`MemoryGovernanceService` 是 UI 和 IPC 的唯一写入口，提供：

- `snapshot()`；
- `updateProfileField(layer, field, value)`；
- `updateL2(id, content)`；
- `deleteProfileField(layer, field)`；
- `deleteL2(id)`；
- `setL2Pinned(id, pinned)`；
- `setL2Enabled(id, enabled)`；
- `restoreL2(id)`；
- `clearLayer(layer)`；
- `runMaintenanceNow()`；
- `audit()`。

所有字符串修改先经过统一的 `MemoryContentPolicy`：长度、Unicode、证据绑定策略和隐私规则。用户编辑视为明确长期保存，因此医疗/法律内容可以通过；永久禁止类别仍拒绝。

删除 L2 时同时删除 Evidence、清理 conflictWith、使相关 ConflictLog 成为不可执行历史记录，并在下一次索引同步中 prune 向量。删除日志不保存被删除正文。如果被删除记忆是某条 summary 的 sourceMemoryId，该 summary 必须立即禁用并标记 sync_failed，直到维护任务重新验证或删除它；不能继续召回证据链已经断裂的摘要。

恢复 archived 记忆会将其设为 active 并重新同步索引。恢复 superseded 或 merged 记忆还必须清除旧 resolution 链并重新运行冲突检测，避免同时激活互相矛盾的版本。

## 9. 冲突检测和评分

### 9.1 候选来源

新 L2 安全写入后，与以下旧记忆比较：

- 向量相似度最高的 5 条 active/aging 记忆；
- 最近三轮注入过的记忆；
- 具有相同高价值主题词的记忆。

同一内容去重不进入冲突流程。

### 9.2 确定性信号

评分信号包括：

- 向量相似度；
- 共享主题；
- 否定或纠正表达；
- “以前、现在、改成、不再、其实”等偏好演化信号；
- 两侧是否都有 Evidence；
- 是否最近被注入；
- 是否涉及 L0/L1 核心画像；
- 固定记忆保护；
- 仅有模糊词重叠的惩罚。

分数范围 0 到 100：

- `< 35`：不创建 ConflictLog；
- `35-54`：idle，后台维护时处理；
- `55-74`：normal，本轮后台队列处理；
- `>= 75`：high，优先处理。

## 10. 自动 Resolver

Resolver 接收两条记忆、Evidence、时间、权重、固定状态和评分信号，返回严格 JSON。它没有 Store 引用。

确定性 `MemoryResolutionApplier` 负责最终操作：

- `unrelated`：保留两条，清除本次冲突标记；
- `context_difference`：保留两条，在 ConflictLog 记录场景差异；
- `preference_evolution`：较新记忆保持 active，旧记忆标记 superseded；
- `direct_conflict`：只有 resolutionConfidence `>= 0.85`、两侧 Evidence 完整且目标未固定时才自动应用；
- `uncertain` 或低置信度：保留两条，ConflictLog 标记 uncertain。

任何自动动作都不得废弃 pinned 记忆。Resolver 不能创建任意 ID、修改未参与冲突的记忆，也不能把内容写入 L0/L1；核心画像提升必须走 Reflection 提议和现有内容策略。

失败最多重试 2 次。之后标记 failed，不能阻塞聊天或队列后续任务。

## 11. 生命周期和访问强化

### 11.1 初始权重

- medium：`0.60 * confidence`；
- high：`0.85 * confidence`；
- pinned：固定为 1；
- summary：不低于 0.75。

### 11.2 召回强化

L2 被实际注入 Prompt 后，后台事务执行：

- `accessCount += 1`；
- 更新 `lastAccessedAt`；
- `weight += 0.05`，最大为 1；
- aging 记忆在强化后达到 0.40 可恢复 active。

### 11.3 时间衰减

每天最多运行一次：

- high 半衰期 90 天；
- medium 半衰期 45 天；
- summary 半衰期 180 天；
- pinned 不衰减；
- weight `< 0.35` 进入 aging；
- weight `< 0.15` 且 30 天未访问进入 archived。

衰减基于上次 decay 时间计算，重复运行同一天不得重复扣减。

### 11.4 L1 过期

- currentProject：90 天未更新时清空；
- recentGoals：45 天未更新时清空；
- recentPreferences：30 天未更新时清空；
- pinned 概念不适用于 L1；
- 用户面板编辑会刷新对应字段 metadata。

## 12. 最近注入抑制

维护会话级 `RecentMemoryTracker`：

- 记录最近 3 轮实际注入的 L2 ID；
- 普通检索结果若连续出现则降低排序权重；
- 语义分数 `>= 0.80` 或用户明确询问同一事件时允许重复；
- tracker 不持久化，重启后清空；
- pinned 记忆仍受抑制，避免每轮重复灌入 Prompt。

## 13. MemoryScheduler

Scheduler 复用稳定 Promise 队列，不使用并发定时任务修改 Store。

触发条件：

- 每次成功写入后立即调度 normal/high Resolver；
- 每 10 次成功记忆写入或距上次维护超过 24 小时，调度完整维护；
- 用户在面板点击“运行维护”时调度一次完整维护；
- Electron 退出屏障必须等待已接受的维护任务。

完整维护顺序固定为：

```text
Resolver idle queue
-> decay
-> L1 expiry
-> reflection proposals
-> compression
-> entity graph rebuild
-> audit
```

同一时刻只能有一个完整维护任务。重复触发合并为一次。

## 14. Reflection

Reflection 从 active/aging L2 中寻找跨事件稳定模式，输出：

- L0 字段提升建议；
- L1 字段更新建议；
- 可压缩的 L2 分组；
- 实体和关系候选。

模型输出必须包含 sourceMemoryIds 和逐条 claim。每个 claim 至少关联一个存在的 Evidence。禁止从 assistant reply、reason、ConflictLog reason 或 AuditLog 推导用户事实。

L0 自动提升要求：

- 至少 3 条不同 L2；
- 跨越至少 7 天，或者来自 3 次不同写入时间；
- verifier confidence `>= 0.90`；
- 不覆盖来源为 user_edit 的现有 L0 值；
- 通过 MemoryContentPolicy。

L1 更新要求 verifier confidence `>= 0.85`。低于阈值只记录跳过摘要，不写入画像。

## 15. 压缩

### 15.1 聚类

只处理：

- active/aging；
- enabled；
- 非 pinned；
- 非 summary；
- 至少 3 条；
- 两两或中心向量相似度达到 0.82；
- 不包含 unresolved direct conflict。

### 15.2 摘要验证

Compressor 输出 summary、sourceMemoryIds、claims 和 evidenceIds。随后使用独立 verifier 检查每条 claim 是否被给定 Evidence 支持。

自动接受条件：

- 所有 ID 存在；
- sourceMemoryIds 至少 3 条且没有重复；
- verifier confidence `>= 0.90`；
- 通过隐私和长度规则；
- 摘要没有把条件事实改成绝对事实；
- 所有源记忆在提交前仍保持原版本和状态。

### 15.3 两阶段提交

1. 生成摘要并完成 verifier，但不修改源记忆状态；
2. 在一个 Store 事务中创建 `syncStatus: pending_sync`、`isEnabled: false` 的 summary，源记忆仍保持原状态；
3. 为 summary 生成 embedding 并持久化向量索引；
4. 索引成功后，在第二个 Store 事务中把 summary 设为 `synced`、`isEnabled: true`，并把源记忆标记 merged 和写入 mergedInto；
5. 索引失败时把 summary 标记 sync_failed，源记忆继续 active/aging；下一次维护只重试同步，不重新调用 Compressor；
6. 任一步发现源记忆 updatedAt 已变化或状态不再符合条件，就废弃 pending summary，不修改源记忆。

原始记忆永不由自动压缩物理删除。

## 16. 实体关系图

与 `memory.json` 同目录的 `entity-graph.json` 是可重建缓存：

```ts
interface EntityNode {
  id: string;
  type: "user" | "person" | "project" | "technology" | "place" | "organization" | "event" | "topic";
  name: string;
  sourceMemoryIds: string[];
}

interface EntityRelation {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  sourceMemoryIds: string[];
}
```

实体名必须是源记忆或 Evidence 中的原样连续片段。关系可以由 Reflection 提议，但两端实体和 sourceMemoryIds 必须通过确定性检查。

实体图只用于：

- 扩展 L2 检索候选；
- 在记忆面板显示关系；
- 为 Reflection 分组提供辅助信息。

图损坏或缺失时从 active/aging memory 重建，不能影响聊天。

## 17. Recall 演进

Recall 只检索：

- `isEnabled === true`；
- status 为 active 或 aging；
- 普通记忆已完成向量同步，summary 必须是 `syncStatus === "synced"`。

最终排序综合：

- 语义相似度为主；
- weight 作为小幅加权；
- pinned 作为小幅加权；
- RecentMemoryTracker 作为重复惩罚；
- 最终仍最多注入 3 条 L2。

不允许低语义相似度仅凭高 weight 或 pinned 进入 Prompt。

ConflictLog 为 uncertain 的两条记忆若同时召回，MemoryContext 必须明确标注“内部记忆存在未决冲突”，不得悄悄选择一边。

## 18. Electron API 和 IPC

新增共享 `MemoryApi`：

```ts
interface MemoryApi {
  getSnapshot(): Promise<MemorySnapshot>;
  updateProfileField(input: UpdateProfileFieldInput): Promise<MemoryMutationResult>;
  updateL2(input: UpdateL2Input): Promise<MemoryMutationResult>;
  deleteProfileField(input: DeleteProfileFieldInput): Promise<MemoryMutationResult>;
  deleteL2(id: string): Promise<MemoryMutationResult>;
  setL2Pinned(input: SetPinnedInput): Promise<MemoryMutationResult>;
  setL2Enabled(input: SetEnabledInput): Promise<MemoryMutationResult>;
  restoreL2(id: string): Promise<MemoryMutationResult>;
  clearLayer(layer: "L0" | "L1" | "L2"): Promise<MemoryMutationResult>;
  runMaintenance(): Promise<MemoryMaintenanceResult>;
  getAuditReport(): Promise<MemoryAuditReport>;
}
```

Renderer 只能通过 Preload 暴露的这些窄函数操作记忆，不能获得文件路径、Node.js API 或任意 Store mutator。

所有 payload 在 Main 中再次验证。关机开始后拒绝新的治理和维护操作，已接受操作纳入同一 shutdown barrier。

## 19. 记忆面板

主界面增加 Chat / Memory 两个顶层视图，不新建营销页。

Memory 视图包含：

- Overview：L0/L1/L2 数量、状态数量、未决冲突、上次维护；
- Profile：L0/L1 可编辑字段；
- Events：可搜索、筛选、排序的 L2 表格；
- Conflicts：分数、优先级、Resolver 状态和自动结果；
- Reflections：提升和压缩历史；
- Audit：结构一致性问题与运行维护按钮；
- Relations：实体与关系列表，首版不引入复杂图形库。

交互约束：

- 编辑使用行内编辑或模态框；
- 固定和启用使用图标按钮、开关和 tooltip；
- 删除和分层清空必须二次确认；
- 不嵌套卡片；
- 列表保持紧凑、可扫描；
- loading、empty、error、disabled 状态完整；
- Memory 与 Chat 切换不清空聊天会话；
- 操作成功后重新获取快照，不在 Renderer 猜测 Store 状态。

## 20. 事件和日志

新增安全事件：

- memory_conflict_detected；
- memory_resolver_started / finished / failed；
- memory_maintenance_started / finished / failed；
- memory_reflection_finished；
- memory_compression_finished；
- memory_governance_changed。

事件只包含计数、阶段、ID、状态和固定摘要，不包含记忆正文、Evidence 原文、模型原始输出或密钥。

AuditLog 与 AgentEvent 分工：AuditLog 持久化治理动作元数据；AgentEvent 用于当前运行时可观测性。

## 21. 故障隔离

- Recall 失败：继续正常聊天；
- access reinforcement 失败：不影响已生成回答；
- conflict detection 失败：记忆仍可安全写入，记录固定失败摘要；
- Resolver 失败：保留新旧记忆；
- decay/L1 expiry 失败：不执行后续破坏性步骤；
- Reflection 失败：不修改画像；
- embedding 或 compression 失败：不归档源记忆；
- entity graph 失败：下一次维护重建；
- UI mutation 失败：Renderer 恢复旧显示并展示安全错误；
- 退出时维护失败：记录固定摘要后允许退出。

## 22. 测试策略

每个模块使用 TDD：

- migration：v1、v2、损坏、重复迁移、备份失败；
- governance：每种 CRUD、隐私、并发、删除级联；
- conflict：正例、反例、分数边界、固定保护；
- resolver：五种结果、低置信度、非法 ID、重试；
- lifecycle：时间边界、半衰期、固定保护、幂等；
- recent tracker：重复抑制和高相似度例外；
- reflection：证据不足、阈值、画像冲突；
- compression：聚类、verifier、两阶段失败恢复；
- entity graph：原文实体约束、重建和损坏恢复；
- recall：状态过滤、weight 加权、冲突标记；
- IPC/preload：channel、payload 验证、关机拒绝；
- renderer：筛选、编辑、删除确认、错误恢复；
- integration：写入 -> conflict -> resolver -> recall；
- manual：DeepSeek、Ollama、Electron、重启、维护和 UI。

每个子阶段结束后运行聚焦测试、全量 Vitest、typecheck 和 build。整个 Phase 7 完成时运行真实模型与真实向量端到端验收。

## 23. 文件边界

新增或拆分的主要模块：

```text
src/main/memory/memory-migrations.ts
src/main/memory/memory-content-policy.ts
src/main/memory/memory-governance.ts
src/main/memory/memory-conflict.ts
src/main/memory/memory-conflict-score.ts
src/main/memory/memory-resolver.ts
src/main/memory/memory-resolution-applier.ts
src/main/memory/memory-lifecycle.ts
src/main/memory/recent-memory-tracker.ts
src/main/memory/memory-scheduler.ts
src/main/memory/memory-reflection.ts
src/main/memory/memory-compressor.ts
src/main/memory/entity-graph.ts
src/main/memory/memory-audit.ts
src/main/memory/memory-maintenance.ts
src/main/app/register-memory-ipc.ts
src/shared/memory-api-types.ts
src/renderer/chat/memory-view.ts
src/renderer/chat/memory-view-model.ts
```

现有 `memory-store.ts` 继续只负责原子 load/update 和 Schema 校验；业务操作进入 governance、resolver applier、lifecycle 和 maintenance 服务。

## 24. 实施顺序

1. Schema v2、迁移和 Store 扩展；
2. ContentPolicy 与 Governance API；
3. IPC、Preload 和基础 Memory Panel；
4. 冲突检测与评分；
5. 自动 Resolver 与 ResolutionApplier；
6. 审计和冲突 UI；
7. 生命周期与 RecentMemoryTracker；
8. Scheduler 与关机屏障；
9. Reflection 与画像提升；
10. 聚类、Verifier 和两阶段压缩；
11. 实体图与 Relations 视图；
12. 完整事件、文档、迁移和端到端验收。

该顺序保证每一步都建立在前一步的稳定接口上，并且任何中间提交都保持聊天功能可用。

## 25. 完成标准

Phase 7 只有同时满足以下条件才算完成：

- v1 用户可无损迁移到 v2；
- 用户可在 UI 中完成所有治理操作；
- 删除和清空会同步清理可检索内容；
- 冲突可以自动检测、评分、解析或安全保留 uncertain；
- pinned 和证据约束不可被自动流程绕过；
- decay、L1 过期和强化是幂等且可测试的；
- Reflection 不会在证据不足时提升画像；
- 压缩失败不会归档原始记忆；
- 实体图损坏不影响聊天且可重建；
- 后台维护与聊天、退出之间没有丢任务竞态；
- Renderer 不接触 Node.js 和文件路径；
- 全量测试、typecheck、build、DeepSeek、Ollama、Electron 和重启验收全部通过；
- 中文学习文档能够解释数据模型、每条工作流和主要代码。
