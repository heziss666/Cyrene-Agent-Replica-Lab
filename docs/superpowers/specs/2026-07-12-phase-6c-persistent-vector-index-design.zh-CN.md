# Phase 6C：持久化向量索引设计

## 1. 阶段目标

Phase 6B 已经实现真实向量检索：

```text
KnowledgeDocument
-> KnowledgeChunk
-> Ollama qwen3-embedding:4b
-> 2560 维向量
-> InMemoryVectorIndex
-> 余弦相似度
-> Top K
```

但当前向量只存在于内存：

```text
应用启动
-> 第一次搜索生成全部文档向量
-> 应用关闭
-> 向量丢失
-> 下次启动重新生成
```

Phase 6C 的目标是把文档向量安全地保存到 JSON 文件，使后续启动可以复用已有文档向量，只为用户问题和新增、修改的文本块生成新向量。

完成后：

```text
第一次运行
-> 文档向量化
-> 保存 vector-index.json

后续运行
-> 加载 vector-index.json
-> 验证索引兼容性
-> 复用已有文档向量
-> 只向量化本次查询
```

## 2. 方案选择

### 2.1 JSON

优点：

```text
容易理解和观察
不增加 npm 依赖
接近源项目实现
适合当前知识库规模
便于学习索引元数据和兼容校验
```

缺点：

```text
浮点向量转换为文本后体积较大
大量数据时加载和保存较慢
不适合最终的大规模知识库
```

### 2.2 SQLite

优点是数据更紧凑、增删改更可靠，更适合后续文件导入和记忆系统。缺点是需要同时学习数据库 Schema、BLOB、迁移和 Electron 原生依赖打包。

### 2.3 专用向量数据库

Qdrant、LanceDB 等适合大规模向量检索，但会引入服务部署或较重依赖，不适合当前阶段。

### 2.4 决策

Phase 6C 使用：

```text
统一 VectorIndex 接口
异步 JSON 实现
线性余弦搜索
模型与内容兼容校验
```

JSON 是第一种持久化实现，不是 RAG 与存储的永久绑定。后续可以在不修改 VectorRetriever 的前提下替换成 SQLite 或其他实现。

## 3. 设计原则

### 3.1 RAG 不直接操作文件

`VectorRetriever` 只能依赖 `VectorIndex` 接口，不能导入 `node:fs`。

### 3.2 存储层不调用模型

`JsonVectorIndex` 负责加载和保存向量，但不能调用 Ollama。Embedding 仍由 `VectorRetriever` 通过 `EmbeddingProvider` 完成。

### 3.3 正确性优先于复用率

只有 Provider、模型、索引版本、向量维度和文本内容全部兼容时才复用旧向量。无法确认兼容时重新生成。

### 3.4 普通测试不依赖 Ollama

所有持久化自动测试使用临时目录和 Fake Provider，不连接 Ollama，不依赖用户目录。

### 3.5 文件操作不能阻塞 Electron 主进程

使用 `node:fs/promises`，不使用 `readFileSync()` 或 `writeFileSync()`。

## 4. 数据目录

默认目录：

```text
~/.cyrene-agent-replica-lab/rag
```

Windows 示例：

```text
C:\Users\123\.cyrene-agent-replica-lab\rag
```

索引文件：

```text
C:\Users\123\.cyrene-agent-replica-lab\rag\vector-index.json
```

允许通过环境变量覆盖：

```env
CYRENE_RAG_DATA_DIR=C:\custom\rag-data
```

新增 `src/main/config/rag-storage-config.ts`：

```ts
export interface RagStorageConfig {
  dataDir: string;
  vectorIndexPath: string;
}

export function loadRagStorageConfig(
  env?: NodeJS.ProcessEnv,
  homeDir?: string,
): RagStorageConfig;
```

测试可传入临时 `homeDir`，避免访问真实用户目录。

## 5. 索引数据结构

新增 `src/main/rag/vector-index-types.ts`。

### 5.1 运行时条目

```ts
export interface VectorIndexEntry {
  chunkId: string;
  textHash: string;
  vector: number[];
}
```

### 5.2 当前索引身份

```ts
export interface VectorIndexIdentity {
  providerId: string;
  model: string;
  schemaVersion: 1;
}
```

向量维度在第一条向量写入时确定，并保存在磁盘元数据中。

### 5.3 磁盘 Schema

```ts
export interface VectorIndexFile {
  schemaVersion: 1;
  embedding: {
    providerId: string;
    model: string;
    dimensions: number;
  };
  chunking: {
    chunkSizeChars: number;
    overlapChars: number;
  };
  entries: VectorIndexEntry[];
}
```

JSON 示例：

```json
{
  "schemaVersion": 1,
  "embedding": {
    "providerId": "ollama",
    "model": "qwen3-embedding:4b",
    "dimensions": 2560
  },
  "chunking": {
    "chunkSizeChars": 600,
    "overlapChars": 120
  },
  "entries": [
    {
      "chunkId": "seed_tool_registry_chunk_0",
      "textHash": "sha256-value",
      "vector": [0.012, -0.084]
    }
  ]
}
```

## 6. 为什么需要 textHash

只使用 `chunkId` 不能判断文本是否发生变化。

例如旧文本：

```text
ToolRegistry registers tools.
```

新文本：

```text
ToolRegistry validates, registers, and executes tools.
```

二者可能仍然拥有：

```text
seed_tool_registry_chunk_0
```

如果只检查 `chunkId`，程序会错误复用旧向量。

新增 `src/main/rag/text-hash.ts`：

```ts
export function hashText(text: string): string;
```

使用 Node.js `createHash("sha256")`：

```text
chunk 原始文本
-> UTF-8
-> SHA-256
-> 十六进制 textHash
```

只有以下条件同时满足才复用：

```text
chunkId 相同
textHash 相同
```

## 7. VectorIndex 接口

当前同步单条写入接口需要升级成异步批量接口：

```ts
export interface VectorIndexEntryKey {
  chunkId: string;
  textHash: string;
}

export type VectorIndexLoadStatus =
  | "missing"
  | "loaded"
  | "incompatible"
  | "corrupt";

export interface VectorIndexLoadResult {
  status: VectorIndexLoadStatus;
  loadedEntries: number;
  warning?: string;
}

export interface VectorIndex {
  initialize(): Promise<VectorIndexLoadResult>;

  has(chunkId: string, textHash: string): boolean;

  get(chunkId: string, textHash: string): number[] | undefined;

  addMany(entries: VectorIndexEntry[]): Promise<void>;

  prune(validEntries: VectorIndexEntryKey[]): Promise<number>;

  clear(): Promise<void>;
}
```

### 7.1 initialize

加载磁盘索引。多次调用必须复用同一个初始化 Promise，不能重复读取文件。

### 7.2 addMany

一次加入一批向量，并只保存一次磁盘文件。

### 7.3 prune

删除当前知识库中已经不存在或 textHash 已变化的旧条目。

### 7.4 clear

清空内存条目和磁盘索引。

## 8. InMemoryVectorIndex

现有 `createInMemoryVectorIndex()` 继续保留，用于：

```text
单元测试
无需持久化的调用方
JsonVectorIndex 的行为对照
```

它实现新的异步接口：

```text
initialize() 立即返回 missing 或 loaded
addMany() 批量写入内存
prune() 删除无效条目
clear() 清空 Map 和 dimensions
```

虽然内部没有 I/O，也保持 Promise 接口，使 `VectorRetriever` 不需要区分内存实现和 JSON 实现。

## 9. JsonVectorIndex

新增 `src/main/rag/json-vector-index.ts`。

构造参数：

```ts
export interface CreateJsonVectorIndexOptions {
  filePath: string;
  identity: VectorIndexIdentity;
  chunkSizeChars: number;
  overlapChars: number;
}
```

职责：

```text
异步读取 JSON
运行时 Schema 校验
Provider 和模型校验
向量维度校验
加载 Map
批量写入
原子保存
prune
clear
损坏文件备份
```

它不负责：

```text
调用 Ollama
切分文档
计算相似度
决定 Top K
```

## 10. 初始化流程

### 10.1 文件不存在

```text
initialize()
-> status: missing
-> 创建空 Map
```

第一次搜索时：

```text
全部 chunk 缺少向量
-> embedDocuments()
-> addMany()
-> 写入 vector-index.json
```

### 10.2 文件存在且兼容

```text
读取 JSON
-> 校验 schemaVersion
-> 校验 providerId
-> 校验 model
-> 校验 chunking
-> 校验 dimensions
-> 校验每个 entry
-> 加载 Map
-> status: loaded
```

搜索时：

```text
chunkId + textHash 命中
-> 不调用 embedDocuments()
-> 只调用 embedQuery()
```

### 10.3 索引不兼容

以下情况返回 `incompatible`：

```text
schemaVersion 不同
providerId 不同
model 不同
chunkSizeChars 不同
overlapChars 不同
```

处理：

```text
不加载旧向量
-> 使用空 Map
-> 下一次搜索重新向量化全部文档
-> 保存新的索引文件
```

旧文件不需要作为损坏文件备份，因为它格式合法，只是与当前配置不兼容。新索引保存成功时原子替换旧文件。

## 11. 损坏文件恢复

以下情况视为 `corrupt`：

```text
不是合法 JSON
缺少必要字段
entries 不是数组
vector 不是数字数组
向量为空
向量维度不一致
出现 NaN 或 Infinity
重复 chunkId 产生冲突
```

恢复流程：

```text
vector-index.json
-> rename 为 vector-index.corrupt-<timestamp>.json
-> 使用空索引
-> status: corrupt
-> warning 记录失败原因和备份路径
```

下一次搜索重新生成文档向量。

## 12. 原子写入

不能直接覆盖正式文件。

保存流程：

```text
确保数据目录存在
-> 序列化 JSON
-> 写入 vector-index.json.tmp
-> rename vector-index.json.tmp 为 vector-index.json
```

首先尝试用同目录临时文件直接替换正式文件。如果 Windows 上目标文件已经存在，且当前运行环境不允许 `rename` 直接替换，则采用可恢复的备份替换流程：

```text
rename vector-index.json 为 vector-index.json.bak
-> rename vector-index.json.tmp 为 vector-index.json
-> 替换成功后删除 vector-index.json.bak
```

如果第二次 `rename` 失败，则立即把 `vector-index.json.bak` 恢复为 `vector-index.json`，然后向上抛出错误。实现中不能在没有备份的情况下先 `unlink` 正式文件。这个 Windows 降级流程强调的是“可恢复替换”；同目录直接 `rename` 成功时才是首选的原子替换路径。

写入失败时：

```text
保留原正式文件
清理本次临时文件（能够安全清理时）
向上抛出明确错误
```

## 13. VectorRetriever 变化

`retrieve()` 新流程：

```text
await index.initialize()
-> 为当前 chunks 计算 textHash
-> await index.prune(current chunkId + textHash)
-> 找出 index.has(chunkId, textHash) 为 false 的 chunks
-> 批量 embedDocuments(missingChunkTexts)
-> await index.addMany(newEntries)
-> embedQuery(query)
-> index.get(chunkId, textHash)
-> cosineSimilarity
-> Top K
```

`prune()` 必须在缺失检测前完成，使修改文本后的旧条目不会继续占用索引。

当 query 为空、chunks 为空或 `topK <= 0` 时：

```text
不调用 Ollama
仍允许 initialize/prune 保持索引一致，或直接返回空结果
```

具体采用：空查询直接返回，不触发磁盘和模型；有效查询时才初始化索引。

## 14. KnowledgeBase 变化

`KnowledgeBase.clear()` 从同步改为异步：

```ts
clear(): Promise<void>;
```

执行：

```text
清空 KnowledgeStore
await VectorRetriever.clear()
-> 清空内存和磁盘索引
```

Electron 的“New Chat”只清除聊天会话，不清除知识库，因此不会调用 `KnowledgeBase.clear()`。知识库 clear 只供未来的知识管理功能和测试使用。

## 15. 默认组装

`createDefaultKnowledgeBase()` 将创建：

```text
EmbeddingConfig
RagStorageConfig
OllamaEmbeddingProvider
JsonVectorIndex
VectorRetriever
KnowledgeBase
```

依赖方向：

```text
KnowledgeBase
-> VectorRetriever
-> VectorIndex 接口
-> JsonVectorIndex

VectorRetriever
-> EmbeddingProvider 接口
-> OllamaEmbeddingProvider
```

上层 `search_knowledge` Tool 不需要知道索引使用 JSON。

## 16. Phase 6B 清理

Phase 6C 开始时先完成两个窄范围清理。

### 16.1 删除 System Prompt 中的工具专用规则

删除 `src/cli/chat.ts` 中：

```text
When using search_knowledge...
```

保留 `search_knowledge` Tool Schema 中的语义 Query 说明。工具参数生成规则属于 Tool Definition，不属于全局 System Prompt。

### 16.2 更新默认知识

更新 `seed_minimal_rag`，不再描述“未来才加入 embedding”。改为准确说明：

```text
Phase 6B uses Ollama embeddings and vector search.
Phase 6C persists document vectors for reuse across application restarts.
```

## 17. 测试设计

新增：

```text
tests/config/rag-storage-config.test.ts
tests/rag/text-hash.test.ts
tests/rag/json-vector-index.test.ts
tests/rag/vector-index-persistence.test.ts
```

修改：

```text
tests/rag/in-memory-vector-index.test.ts
tests/rag/vector-retriever.test.ts
tests/rag/knowledge-base.test.ts
tests/tools/built-in-tools.test.ts
tests/cli/chat.test.ts
```

关键测试：

```text
默认数据目录和环境变量覆盖
SHA-256 稳定性和文本变化
文件不存在时初始化空索引
首次 addMany 保存文件
第二个实例加载已有向量
模拟应用重启后 embedDocuments 调用次数为 0
新增 chunk 只向量化新增内容
修改 chunk 只向量化修改内容
删除 chunk 后 prune 磁盘条目
模型变化导致 incompatible 和全量重建
切块配置变化导致全量重建
损坏 JSON 被备份并重建
非法向量被拒绝
一批向量只触发一次磁盘保存
clear 同时清空内存和磁盘
System Prompt 不包含工具专用规则
Tool Schema 继续包含语义 Query 规则
```

所有文件测试使用 `mkdtemp()` 创建临时目录，并在测试结束后清理。

## 18. 事件与可观察性

本阶段不新增 AgentEvent 类型。持久化状态通过内部日志记录：

```text
[RAG] vector index missing
[RAG] vector index loaded: 3 entries
[RAG] vector index incompatible: model changed
[RAG] vector index corrupt: backup created at ...
[RAG] vector index saved: 3 entries
```

`search_knowledge` Tool 继续输出：

```text
retrieval_mode: vector
embedding_model: qwen3-embedding:4b
```

索引加载状态不加入每一次 Tool 输出，避免把存储实现细节反复发送给聊天模型。

## 19. 验收标准

自动验证：

```cmd
npm test
npm run typecheck
npm run build
```

真实模型验证：

```cmd
npm run test:embedding
```

持久化手动验证：

```text
1. 删除或移动现有测试索引
2. 启动 Electron 并第一次搜索
3. 确认 vector-index.json 创建
4. 关闭并重新启动 Electron
5. 再次搜索
6. 确认加载日志显示已有条目
7. 确认不重新生成文档向量，只生成 query 向量
```

必须满足：

```text
首次搜索生成并保存文档向量
应用重启后复用文档向量
模型变化时不复用旧向量
文本变化时只更新对应向量
删除文本时清理旧向量
文件损坏时 Agent 不崩溃并安全重建
普通测试不连接 Ollama
```

## 20. 明确不包含的内容

Phase 6C 不实现：

```text
用户文件导入
文档管理 UI
SQLite
专用向量数据库
BM25
混合检索
Reranker
IVF 或 HNSW
Embedding 模型切换界面
记忆系统
```

## 21. 后续阶段

Phase 6D 将在持久化索引基础上实现用户文档导入：

```text
选择 Markdown/TXT 文件
解析文本
切块
增量向量化
保存原始文档元数据
删除和重新索引
```

Phase 6E 再实现关键词与向量混合检索。

## 22. 最终实现加固补充

最终审查后的实现以本节为准，取代前文中简化的固定 `.tmp`、先改内存再保存等伪代码：

- `addMany()` 和 `prune()` 使用“克隆 staged state -> 持久化 -> 提交内存”的事务顺序；保存失败保留旧内存状态并允许重试。
- retriever 的完整索引同步与 clear 串行化，JSON index 的 mutations 也在实例内串行化。
- 临时文件使用同目录 writer-unique 名称；Windows 降级替换前必须在正式文件仍完整时严格退役旧 `.bak`。
- 启动同时解析 formal/backup/tmp 状态；损坏 formal 可恢复已验证的 backup，清理错误不得遮蔽主要错误。
- logger 仅用于观测且永不向业务路径抛错；运行时严格校验 schema identity、非空 ID、SHA-256 hash 和切块边界。
- query 与已存文档向量维度变化时，只清空并重建一次文档向量，同时复用当前 query vector。
- 串行保证仅覆盖同一进程内的实例边界；多个 OS 进程同时写同一路径仍明确不受支持。
