# Phase 6B：Ollama 向量 RAG 设计

## 1. 阶段目标

Phase 6A 已经实现了一个可以工作的最小 RAG：文档切块、内存存储、关键词检索，以及供 Agent 调用的 `search_knowledge` 工具。

Phase 6B 的目标是在保留现有关键词检索的基础上，引入真实的本地 embedding 和向量检索：

```text
KnowledgeChunk[]
-> Ollama qwen3-embedding:4b
-> 文档向量
-> 内存向量索引
-> 用户问题向量
-> 余弦相似度
-> Top K 相关文本块
-> search_knowledge Tool
-> Agent 最终回答
```

本阶段使用用户本机已经安装的 Ollama 模型：

```text
qwen3-embedding:4b
```

DeepSeek 继续作为聊天模型。Embedding 模型只负责检索，聊天模型只负责读取检索结果并生成回答。

## 2. 设计原则

### 2.1 Provider 可替换

RAG 模块不能直接依赖 Ollama 的 HTTP 格式，而是依赖统一的 `EmbeddingProvider` 接口。Ollama 只是该接口的第一种真实实现。

未来可以继续增加：

```text
OpenAICompatibleEmbeddingProvider
TransformersJsEmbeddingProvider
其他本地或远程 EmbeddingProvider
```

### 2.2 每个模块只承担一种职责

模块按照以下边界拆分：

```text
EmbeddingProvider     定义向量化能力
Ollama Provider       调用 Ollama HTTP API
Vector Math           执行纯数学计算
Vector Index          保存 chunkId 与向量
Vector Retriever      组织索引和相似度搜索
KnowledgeBase         对外提供统一搜索入口
search_knowledge      把 KnowledgeBase 暴露给 Agent
```

### 2.3 保持可运行和可降级

Ollama 没有启动、模型不存在或向量响应非法时，Agent 不应崩溃。`KnowledgeBase` 将回退到 Phase 6A 的关键词检索，并明确报告回退原因。

### 2.4 普通测试不依赖本机服务

`npm test` 必须可以在没有 Ollama、没有模型和没有网络的环境中运行。单元测试使用 Fake Provider 和模拟 HTTP 响应；真实 Ollama 通过独立命令验证。

## 3. 总体架构

### 3.1 文档索引流程

```text
default-knowledge.ts
-> KnowledgeDocument[]
-> chunk-text.ts
-> KnowledgeChunk[]
-> vector-retriever.ts 检查缺少向量的 chunk
-> ollama-embedding-provider.ts 批量调用 /api/embed
-> number[][]
-> in-memory-vector-index.ts
-> Map<chunkId, vector>
```

### 3.2 用户查询流程

```text
用户问题
-> search_knowledge Tool
-> KnowledgeBase.search(query, topK)
-> VectorRetriever.retrieve(query, chunks, topK)
-> OllamaEmbeddingProvider.embedQuery(query)
-> 问题向量
-> cosineSimilarity(queryVector, chunkVector)
-> 按分数降序排列
-> Top K KnowledgeSearchResult[]
-> Tool 结果回填 Agent Loop
-> DeepSeek 生成最终答案
```

### 3.3 故障回退流程

```text
向量检索失败
-> KnowledgeBase 捕获错误
-> keyword-retriever.ts
-> 返回关键词结果
-> response.mode = "keyword-fallback"
-> response.warning 记录原始失败原因
```

## 4. 配置设计

新增 `src/main/config/embedding-config.ts`：

```ts
export interface EmbeddingConfig {
  provider: "ollama";
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
}
```

读取以下环境变量：

```env
CYRENE_EMBEDDING_PROVIDER=ollama
CYRENE_OLLAMA_BASE_URL=http://127.0.0.1:11434
CYRENE_EMBEDDING_MODEL=qwen3-embedding:4b
```

默认值：

```text
provider          ollama
baseUrl           http://127.0.0.1:11434
model             qwen3-embedding:4b
requestTimeoutMs  120000
```

本阶段不要求用户配置向量维度。向量维度由 Ollama 返回的第一个合法向量确定，内存索引随后拒绝不同维度的向量。

Embedding 配置与现有聊天模型配置相互独立。Embedding 不使用 `CYRENE_MODEL_API_KEY`。

## 5. Embedding Provider

新增 `src/main/rag/embedding-provider.ts`：

```ts
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;

  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}
```

`embedDocuments()` 和 `embedQuery()` 分开定义，因为部分 embedding 模型对查询和文档使用不同的预处理或指令。

### 5.1 Ollama 实现

新增 `src/main/rag/ollama-embedding-provider.ts`。

它只负责：

```text
规范化 baseUrl
构造 POST /api/embed 请求
对文档执行批量向量化
为查询添加固定检索指令
使用 AbortController 实现超时
解析 Ollama 响应
验证向量数量、维度和数值合法性
产生可理解的错误信息
```

文档请求示例：

```json
{
  "model": "qwen3-embedding:4b",
  "input": [
    "第一段知识",
    "第二段知识"
  ]
}
```

查询文本格式：

```text
Instruct: Retrieve relevant passages from the local knowledge base that answer the user's question.
Query: <用户原始问题>
```

文档文本不添加查询指令。

### 5.2 响应验证

Provider 必须拒绝以下响应：

```text
embeddings 字段不存在
文档输入数量与返回向量数量不一致
向量为空
同一批向量维度不同
向量包含 NaN 或 Infinity
HTTP 状态不是 2xx
请求超过 120 秒
```

## 6. 向量数学

新增 `src/main/rag/vector-math.ts`：

```ts
export function cosineSimilarity(a: number[], b: number[]): number;
```

实现完整余弦相似度：

```text
cos(a, b) = dot(a, b) / (norm(a) * norm(b))
```

不假设 Ollama 返回的向量已经归一化。函数必须检查：

```text
向量不能为空
两个向量维度相同
所有元素是有限数值
向量范数不能为 0
```

这比源项目中直接使用点积更适合学习，也避免 Provider 改变后产生错误假设。

## 7. 内存向量索引

新增 `src/main/rag/in-memory-vector-index.ts`。

核心接口：

```ts
export interface VectorIndex {
  has(chunkId: string): boolean;
  add(chunkId: string, vector: number[]): void;
  get(chunkId: string): number[] | undefined;
  clear(): void;
}
```

实现使用：

```ts
Map<string, number[]>
```

索引保存第一个向量的维度。后续写入不同维度时抛出错误。返回向量时使用副本，避免调用方修改索引内部数据。

本阶段索引只存在于内存中，应用关闭后丢失。Phase 6C 再增加持久化索引和模型元数据。

## 8. 向量检索器

新增 `src/main/rag/vector-retriever.ts`。

职责：

```text
接收 KnowledgeChunk[]
找出 VectorIndex 中不存在的 chunkId
批量调用 embedDocuments()
把新向量写入 VectorIndex
调用 embedQuery()
计算问题与每个文本块的余弦相似度
按 score 降序排序
返回 Top K
```

文档向量采用增量生成：

```text
已有 chunkId  不重复调用 embedding
新增 chunkId  下一次搜索时补充 embedding
```

当 `topK <= 0`、查询为空或文本块为空时，直接返回空结果，不调用 Ollama。

## 9. KnowledgeBase 变化

修改 `src/main/rag/rag-types.ts`：

```ts
export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms?: string[];
}

export interface KnowledgeSearchResponse {
  mode: "vector" | "keyword-fallback";
  model?: string;
  results: KnowledgeSearchResult[];
  warning?: string;
}
```

修改 `src/main/rag/knowledge-base.ts`：

```ts
search(query: string, topK?: number): Promise<KnowledgeSearchResponse>;
```

行为：

```text
向量检索成功  mode = vector
向量检索失败  mode = keyword-fallback
回退时         warning = 原始错误信息
clear()         同时清空文本块和向量索引
```

`addDocument()` 保持同步，因为它只负责文档切块和文本存储。新文本块的向量在下一次异步搜索时生成。

## 10. Tool 集成

修改 `src/main/tools/built-in-tools.ts`。

`search_knowledge` 工具等待异步搜索：

```ts
const response = await knowledgeBase.search(query, topK);
```

工具结果必须包含：

```text
retrieval_mode: vector
embedding_model: qwen3-embedding:4b
```

发生回退时包含：

```text
retrieval_mode: keyword-fallback
warning: <Ollama 或向量检索错误>
```

每个结果继续包含标题、来源、分数和正文。只有关键词结果显示 `matched_terms`。

Agent Loop、Vendor Adapter 和 IPC 接口不需要修改，因为工具执行接口已经是异步的，工具输出仍然是字符串。

## 11. 错误处理

以下错误只导致本次搜索回退，不导致 Agent 或 Electron 崩溃：

```text
Ollama 未启动
模型不存在
请求超时
HTTP 错误
响应 JSON 格式错误
向量数量错误
向量维度错误
向量包含非法数字
余弦相似度计算失败
```

错误不能被静默吞掉。`KnowledgeSearchResponse.warning` 和工具输出都必须保留可理解的原因。

## 12. 测试设计

### 12.1 普通自动测试

新增：

```text
tests/config/embedding-config.test.ts
tests/rag/vector-math.test.ts
tests/rag/in-memory-vector-index.test.ts
tests/rag/ollama-embedding-provider.test.ts
tests/rag/vector-retriever.test.ts
```

修改：

```text
tests/rag/knowledge-base.test.ts
tests/tools/built-in-tools.test.ts
tests/agent/tool-agent.test.ts
tests/cli/chat.test.ts
```

测试使用 Fake Provider 或模拟 `fetch`，覆盖：

```text
配置默认值和环境变量覆盖
文档与查询请求格式不同
批量响应解析
超时与 HTTP 错误
非法向量响应
余弦相似度正确性
维度不匹配
文档向量只生成一次
新增文档增量向量化
Top K 排序
关键词故障回退
Tool 输出检索模式
```

`npm test` 不连接真实 Ollama。

### 12.2 真实 Ollama 测试

新增 `src/cli/test-embedding.ts` 和 package script：

```json
{
  "test:embedding": "tsx src/cli/test-embedding.ts"
}
```

命令：

```cmd
npm run test:embedding
```

测试三条文本：

```text
A：Agent 可以通过 ToolRegistry 注册工具
B：工具需要先加入注册表才能被模型调用
C：今天天气很好
```

验收条件：

```text
输出 provider 和 model
输出实际向量维度
所有向量维度一致
similarity(A, B) > similarity(A, C)
```

## 13. 明确不包含的内容

Phase 6B 不实现：

```text
JSON、SQLite 或专用向量数据库持久化
文件导入
文档删除和更新界面
Embedding 模型切换界面
OpenAI-compatible embedding
Transformers.js 内置模型
BM25
关键词与向量结果融合
Reranker
IVF、HNSW 等近似向量索引
后台启动时预加载
RAG 设置页面
```

关键词检索只作为故障回退，不是混合检索。

## 14. 与源项目的关系

源项目已经包含：

```text
本地 Transformers.js Provider
OpenAI-compatible Provider
JSON Vector Store
BM25 混合检索
IVF 索引
记忆权重和衰减
Worldbook
文件导入
```

这些能力集中在较少文件中，并与记忆系统存在较强关联。学习版 Phase 6B 只复刻其中最基础的 Provider、向量存储和相似度搜索，同时进一步拆分职责。

源项目中余弦相似度依赖“向量已经归一化”的前提并直接计算点积；学习版将实现完整余弦公式，降低隐含假设。

源项目的 IVF 优化只有在数据量增大后才有价值。学习版先使用 O(n) 线性搜索，确保可以直接观察和理解每个文本块的评分过程。

## 15. 验收标准

自动验证：

```cmd
npm test
npm run typecheck
npm run build
```

真实模型验证：

```cmd
ollama list
npm run test:embedding
```

Electron 完整链路验证：

```cmd
npm run dev:electron
```

向 Agent 提问：

```text
请搜索知识库，Agent 是怎样注册和执行工具的？
```

正常结果必须显示：

```text
retrieval_mode: vector
embedding_model: qwen3-embedding:4b
```

关闭 Ollama 后再次提问，必须显示：

```text
retrieval_mode: keyword-fallback
warning: <明确的连接失败原因>
```

同时 Agent 继续运行，Electron 不崩溃。

## 16. 后续阶段

Phase 6C 将在本设计基础上增加：

```text
向量持久化
Provider 和模型元数据
索引版本
模型变化检测
索引重建
```

后续再逐步加入文档导入、OpenAI-compatible Provider、混合检索和 Reranker。
