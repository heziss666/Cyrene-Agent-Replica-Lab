# Phase 7：完整长期记忆系统学习指南

本文面向熟悉 Python、正在学习 TypeScript 和 Agent 开发的读者。目标不是只知道“这里用了记忆”，而是理解一条用户消息如何经过提取、存储、召回、冲突处理、生命周期维护、反思、压缩和实体图重建。

## 1. 先建立整体模型

这个项目把记忆分成三层：

| 层级 | 保存什么 | 例子 | 生命周期 |
| --- | --- | --- | --- |
| L0 | 稳定用户画像 | 职业、长期兴趣、语言 | 默认长期保留 |
| L1 | 当前状态 | 当前项目、近期目标、近期偏好 | 30/45/90 天后可过期 |
| L2 | 具体事件 | 完成某个里程碑、某次明确选择 | 会衰减、归档、合并 |

Python 类比：

```python
memory = {
    "l0": {"occupation": "student"},
    "l1": {"currentProject": "Agent Lab"},
    "l2": [{"id": "m1", "content": "completed phase 6"}],
}
```

TypeScript 版本额外通过接口约束字段、状态和返回类型，主要定义在：

```text
src/main/memory/memory-types.ts
src/shared/memory-api-types.ts
```

## 2. Schema v2 为什么字段很多

`L2MemoryV2` 不只有文本，还保存：

- `evidenceIds`：该事实由哪些证据支持；
- `weight`：生命周期权重；
- `lastAccessedAt`、`accessCount`：实际注入 Prompt 后的访问记录；
- `isPinned`：用户固定，不自动衰减；
- `isEnabled`：是否允许召回；
- `status`：active、aging、archived、superseded、merged；
- `syncStatus`：pending_sync、synced、sync_failed；
- `isSummary`：是否为压缩摘要；
- `sourceMemoryIds`、`sourceSnapshots`：摘要来自哪些原记忆以及创建时版本；
- `conflictWith`：关联的冲突记忆。

这些字段解决的是“记忆文本存在”之外的问题：它是否可信、是否还有效、向量是否写成功、能否被召回、是否已被新事实取代。

旧版 v1 文件由 `memory-store.ts` 在加载时迁移。迁移先验证，写备份，再原子替换，失败不会悄悄覆盖原文件。

## 3. 一次正常写入的完整流程

```text
Renderer 发送消息
-> Preload 暴露的安全 API
-> IPC: cyrene:chat:send-message
-> Main 运行 Agent
-> 先返回主回答
-> 后台 MemoryJudge 提取候选记忆
-> MemoryContentPolicy 检查证据与敏感信息
-> MemoryManager 在一个 Store 事务中写入
-> ConflictService 检查新 L2
-> ResolverQueue 异步解决冲突
```

重要设计：主回答不等待后台记忆写入。记忆系统失败时，聊天仍然可用。

Python 类比：

```python
reply = await agent.chat(message)
asyncio.create_task(extract_and_store_memory(message, reply))
return reply
```

对应代码：

```text
src/main/app/register-chat-ipc.ts
src/main/memory/memory-judge.ts
src/main/memory/memory-content-policy.ts
src/main/memory/memory-manager.ts
src/main/memory/memory-write-queue.ts
```

## 4. Evidence 为什么必须独立保存

模型生成的记忆结论不是证据。`MemoryEvidence` 保存用户原话、捕获时间和来源。写入时必须满足：

1. `evidenceQuote` 真的是用户消息中的连续片段；
2. 记忆内容不能增加证据中不存在的事实；
3. API Key、密码、银行卡、证件号和精确地址永不保存；
4. 医疗、法律隐私需要明确的长期保存意图。

审计日志和事件只记录 ID、计数、状态码，不记录 Evidence 全文。

## 5. Governance、IPC、Preload、Renderer 的边界

`memory-governance.ts` 是用户主动管理记忆的业务层：

- 编辑 L0/L1/L2；
- 删除字段或 L2；
- pin、enable、restore；
- 清空某一层；
- 运行完整性审计。

Renderer 不能直接读写 `memory.json`。调用链是：

```text
Memory 页面按钮
-> window.cyrene.memory.updateL2(...)
-> preload/index.ts
-> IPC channel
-> register-memory-ipc.ts
-> MemoryGovernanceService
-> MemoryStore 原子写入
-> 返回脱敏 MemorySnapshot
```

这相当于把 Node.js 文件权限留在 Main，只给网页层有限、可验证的函数。

## 6. 冲突检测、评分、Resolver、Applier 为什么分开

四层职责分别是：

| 模块 | 职责 |
| --- | --- |
| conflict-score | 纯计算，给出冲突分数 |
| conflict-service | 找候选并创建 ConflictLog |
| resolver | 调用 LLM，提出结构化解决方案 |
| resolution-applier | 再次验证当前状态并执行方案 |

LLM 的 Resolver 输出是不可信提案。Applier 会检查 ID、状态、置信度、pin 保护和版本是否仍然有效。这样即使模型输出错误，也不能直接修改文件。

## 7. Recall 的实际排序

向量检索先产生 `semanticScore`，然后加入记忆权重、pin 奖励和最近注入惩罚：

```ts
finalScore = semanticScore
  + Math.min(0.08, memory.weight * 0.08)
  + (memory.isPinned ? 0.03 : 0)
  - recentPenalty;
```

仍然要求原始语义分数至少为 `0.35`，最多返回三条。以下记忆会被过滤：

- disabled；
- archived、superseded、merged；
- 尚未同步成功的 summary；
- 向量索引中存在但 Store 已不存在的 ID。

`RecentMemoryTracker` 保留最近三轮已注入 ID。低于 0.80 的普通匹配会受到最多 0.12 的惩罚，高相关记忆不惩罚。

## 8. 访问强化和生命周期衰减

只有真正注入 Prompt 的 L2 才强化：

```text
accessCount += 1
lastAccessedAt = now
weight = min(1, weight + 0.05)
```

衰减使用指数半衰期：

```ts
nextWeight = currentWeight * Math.pow(0.5, elapsedDays / halfLifeDays);
```

半衰期：medium 45 天、high 90 天、summary 180 天。

- 权重 `< 0.35`：进入 aging；
- aging 权重 `< 0.15` 且至少 30 天未访问：archived；
- active 不会一步跨到 archived；
- pinned 权重保持 1；
- disabled 仍会衰减，因为 disabled 是召回设置，不是生命周期状态。

`lastDecayAt` 保证 24 小时内重复维护不会重复衰减。

## 9. L1 自动过期

过期依据字段自己的 `fieldMetadata.updatedAt`：

| 字段 | 阈值 |
| --- | --- |
| currentProject | 90 天 |
| recentGoals | 45 天 |
| recentPreferences | 30 天 |

没有 metadata 的迁移数据不会被猜测删除。字段内容和 metadata 在同一个事务中清除。

## 10. Scheduler 和关机屏障

维护由两个条件触发：

- 成功写入累计到 10 次；
- 距上次维护达到 24 小时；
- 用户也可以手动点击 Run Maintenance。

`MemoryScheduler` 保证同一时刻只有一条维护流水线。运行期间的重复请求会合并成至多一次 follow-up，不会并行修改 Store。

维护顺序固定：

```text
resolver-idle
-> decay
-> l1-expiry
-> reflection
-> compression
-> entity-graph
-> audit
```

退出 Electron 时，接受入口先关闭，再等待聊天、Resolver 和维护任务全部排空。

## 11. Reflection 为什么必须有 verifier

Reflection 只负责提出：

- L0/L1 更新建议；
- 可能的压缩组；
- 实体和关系。

它不能直接写 Store。每个 Profile 建议包含 sourceMemoryIds、sourceSnapshots、原子 claims 和 evidenceIds。独立 verifier 再判断每个 claim 是否得到证据支持。

L0 晋升要求：至少三个来源、三个不同捕获时间或七天跨度、提案和 verifier 均不低于 0.90。L1 至少两个来源，阈值 0.85。用户手动编辑的 L0 字段不会被自动覆盖。

## 12. 语义聚类

压缩前只选择：enabled、unpinned、synced、active/aging、非 summary、无未决直接冲突的 L2。

所有候选一次批量 embedding，然后进行 O(n²) 两两余弦相似度计算。相似度至少 0.82 的边通过 union-find 组成连通分量，少于三条的组丢弃。

确定性规则：组内 ID 排序，组之间按首个 ID 排序；相同输入一定得到相同结果。

## 13. 两阶段压缩为什么不能一步完成

正确顺序：

```text
1. Compressor 提出摘要
2. verifier 检查所有 claims
3. Store 写入 disabled + pending_sync summary
4. Ollama 生成摘要向量
5. VectorIndex 原子持久化
6. Store 再检查 sourceSnapshots
7. summary 变为 enabled + synced
8. 原记忆变为 merged，并写 mergedInto
```

如果第 4 或第 5 步失败，summary 为 disabled/sync_failed，原记忆保持 active/aging。若第 6 步发现来源已变化，也不会合并来源。下一次维护可以只重试向量同步，不再调用 Compressor。

## 14. Entity Graph 的权威边界

`entity-graph.json` 是派生缓存，不是事实来源。它可以删除并从有效记忆重建。

节点只允许 user、person、project、technology、place、organization、event、topic。实体名称必须是来源记忆或 Evidence 中的连续片段。关系端点必须是已接受节点，关系 provenance 必须同时属于两个端点。

图只用于 UI 浏览和未来的候选扩展，不能把节点文本直接当成用户事实注入 Prompt。

## 15. Memory 页面各标签

- Overview：层级、状态、维护时间和手动维护；
- Profile：编辑 L0/L1；
- Events：筛选、编辑、pin、enable、restore、删除 L2；
- Conflicts：查看脱敏冲突状态；
- Reflections：时间、类型、字段、接受/跳过计数和来源 ID；
- Relations：可筛选节点和关系列表；
- Audit：结构完整性问题和元数据日志。

## 16. 数据文件

默认目录为 `~/.cyrene-agent-replica-lab`：

```text
memory.json                 权威记忆数据
rag/memory-vector-index.json L2/summary 向量索引
entity-graph.json           可重建关系缓存
memory.pre-v2-*.json        仅真实 v1 迁移时出现的备份
```

RAG 文档索引位于其 `rag` 子目录。API Key 只在环境变量或本地 `.env` 中，不应进入这些文件。

## 17. 关键测试文件

```text
tests/memory/memory-migrations.test.ts
tests/memory/memory-governance.test.ts
tests/memory/memory-conflict*.test.ts
tests/memory/memory-lifecycle.test.ts
tests/memory/memory-scheduler.test.ts
tests/memory/memory-reflection*.test.ts
tests/memory/memory-profile-promoter.test.ts
tests/memory/memory-clustering.test.ts
tests/memory/memory-compress*.test.ts
tests/memory/memory-summary-sync.test.ts
tests/memory/entity-graph*.test.ts
tests/integration/memory-reflection-compression.test.ts
```

运行：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:embedding
```

## 18. 手动验收步骤

只使用虚构事实：

1. 启动 `npm.cmd run dev:electron`；
2. 输入“请记住：我的职业是测试工程师”，确认 Profile；
3. 输入一个虚构里程碑，重启后询问，确认可召回；
4. 连续提供三个语义相关的虚构事件；
5. 在 Overview 点击 Run Maintenance；
6. 查看 Reflections、Relations 和 Audit；
7. 确认 summary 只有在向量同步后 enabled，来源随后才 merged；
8. 停止 Ollama 后再次测试压缩，确认原来源仍 active/aging；
9. 输入虚构 API Key 并要求记住，确认 `memory.json` 和事件日志中都不存在它；
10. 缩窄窗口，检查标签、表格、按钮无重叠；
11. 退出后确认没有遗留 Electron 进程。

## 19. 最重要的工程思想

完整记忆系统不是“把聊天记录写进 JSON”。它是由以下原则组成的状态机：

1. 模型输出永远是不可信提案；
2. Evidence 与结论分离；
3. 所有写入都有确定性验证；
4. Store 使用事务和原子文件替换；
5. 向量和 Store 跨系统更新使用两阶段状态；
6. 后台失败不能破坏主聊天；
7. 缓存可以重建，只有 memory.json 是权威；
8. 事件和审计只暴露安全元数据。

理解这八点，就已经掌握了这个项目记忆系统的核心，而不仅是表面上的“RAG + JSON”。
