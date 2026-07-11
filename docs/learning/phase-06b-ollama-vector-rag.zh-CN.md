# Phase 6B：Ollama 向量 RAG 学习文档

## 1. 这一阶段解决了什么问题

Phase 6A 使用关键词检索。它只能判断查询和文档是否出现了相同文字。

例如知识库保存：

```text
工具需要先加入注册表，之后模型才能调用。
```

用户查询：

```text
Agent 是怎样登记新能力的？
```

两句话表达的意思接近，但没有共同的核心词，简单关键词检索可能找不到。

Phase 6B 使用 embedding 模型把文本变成向量：

```text
文本
-> qwen3-embedding:4b
-> [0.021, -0.137, 0.084, ...]
```

语义接近的文本，向量方向通常也更接近。程序可以通过余弦相似度寻找相关资料，不再要求原文和问题使用完全相同的词。

当前职责分工是：

```text
qwen3-embedding:4b  负责把文本变成向量
向量检索器            负责寻找相关文本块
DeepSeek             负责阅读文本块并生成回答
Agent Loop           负责调用 search_knowledge 工具
```

## 2. 文档索引和用户查询是两条不同流程

完整向量 RAG 包含两条流程。

第一条是文档索引：

```text
KnowledgeDocument
-> chunkDocument()
-> KnowledgeChunk[]
-> embedDocuments()
-> 文档向量
-> VectorIndex
```

第二条是用户查询：

```text
用户问题
-> embedQuery()
-> 问题向量
-> 与文档向量计算相似度
-> Top K 文本块
```

文档向量不需要在每次查询时重新生成。当前进程第一次搜索时，`VectorRetriever` 会找出没有向量的 chunk，并批量生成向量。后续搜索只生成新的问题向量。

如果运行期间加入新文档：

```text
旧 chunk 已在 VectorIndex 中  -> 复用旧向量
新 chunk 不在 VectorIndex 中  -> 只生成新向量
```

当前索引只存在内存中，所以应用重启后需要重新生成。Phase 6C 才会把向量保存到磁盘。

## 3. EmbeddingProvider 为什么存在

核心接口位于 `src/main/rag/embedding-provider.ts`：

```ts
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;

  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}
```

它只规定“向量化服务必须具备什么能力”，没有规定必须使用 Ollama。

Python 可以类比成：

```python
from typing import Protocol

class EmbeddingProvider(Protocol):
    id: str
    model: str

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        ...

    async def embed_query(self, query: str) -> list[float]:
        ...
```

`VectorRetriever` 只依赖这个接口，因此未来可以替换成：

```text
OllamaEmbeddingProvider
OpenAICompatibleEmbeddingProvider
TransformersJsEmbeddingProvider
```

为什么把 `embedDocuments()` 和 `embedQuery()` 分开？因为一些 embedding 模型要求查询和文档使用不同的预处理。Qwen3 Embedding 的查询侧可以加入任务指令，文档侧保持原文。

## 4. OllamaEmbeddingProvider 如何调用模型

实现位于 `src/main/rag/ollama-embedding-provider.ts`。

创建 Provider 时传入：

```ts
createOllamaEmbeddingProvider({
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen3-embedding:4b",
  requestTimeoutMs: 120_000,
});
```

文档向量化会向 Ollama 发送批量请求：

```json
{
  "model": "qwen3-embedding:4b",
  "input": [
    "第一段知识",
    "第二段知识"
  ]
}
```

接口地址是：

```text
POST http://127.0.0.1:11434/api/embed
```

Ollama 返回：

```json
{
  "embeddings": [
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6]
  ]
}
```

真实的 `qwen3-embedding:4b` 返回 2560 维，而不是示例里的 3 维。

查询侧会先组成：

```text
Instruct: Retrieve relevant passages from the local knowledge base that answer the user's question.
Query: 用户原始问题
```

再发送给 Ollama。这条指令告诉模型：当前文本不是普通文档，而是一个需要检索相关资料的问题。

Provider 还负责检查：

```text
HTTP 是否成功
响应是否包含 embeddings
返回数量是否等于输入数量
每个向量是否非空
同一批向量维度是否一致
向量中是否出现 NaN 或 Infinity
请求是否超过超时时间
Ollama 是否可以连接
```

这些检查必须放在系统边界。下游代码拿到 `number[][]` 后，可以相信数据格式正确。

## 5. 向量和余弦相似度

数学实现位于 `src/main/rag/vector-math.ts`。

假设两个二维向量：

```text
A = [1, 0]
B = [0.9, 0.1]
```

先计算点积：

```text
A · B = 1 × 0.9 + 0 × 0.1 = 0.9
```

再计算长度：

```text
|A| = sqrt(1² + 0²) = 1
|B| = sqrt(0.9² + 0.1²) ≈ 0.9055
```

余弦相似度：

```text
cos(A, B) = 0.9 / (1 × 0.9055) ≈ 0.9939
```

这个分数很接近 1，说明方向很接近。

代码没有假设 Ollama 已经归一化向量，而是实现完整公式：

```ts
return dot / (Math.sqrt(normA) * Math.sqrt(normB));
```

函数会拒绝空向量、零向量、维度不同的向量以及非法数值。否则数学结果可能没有意义。

## 6. InMemoryVectorIndex 保存了什么

索引位于 `src/main/rag/in-memory-vector-index.ts`。

内部核心结构是：

```ts
Map<string, number[]>
```

可以想象成：

```text
seed_project_overview_chunk_0 -> [2560 个数字]
seed_tool_registry_chunk_0    -> [2560 个数字]
seed_minimal_rag_chunk_0      -> [2560 个数字]
```

Python 类比：

```python
vectors: dict[str, list[float]] = {}
vectors[chunk_id] = vector.copy()
```

索引提供四个动作：

```ts
has(chunkId)
add(chunkId, vector)
get(chunkId)
clear()
```

`add()` 和 `get()` 都复制数组，避免外部代码修改索引内部数据。

第一条向量写入后，索引会记住维度。例如第一条是 2560 维，后面出现 1024 维就立即报错。这可以防止不同 embedding 模型的向量混在一个索引中。

## 7. VectorRetriever 如何完成检索

检索器位于 `src/main/rag/vector-retriever.ts`。

`retrieve()` 的输入是：

```ts
retrieve(query, chunks, topK)
```

第一步，找出缺少向量的文本块：

```ts
const missingChunks = chunks.filter((chunk) => !index.has(chunk.id));
```

第二步，一次性批量向量化：

```ts
const vectors = await provider.embedDocuments(
  missingChunks.map((chunk) => chunk.text),
);
```

第三步，把向量写入索引：

```ts
index.add(chunk.id, vectors[chunkIndex]);
```

第四步，向量化问题：

```ts
const queryVector = await provider.embedQuery(normalizedQuery);
```

第五步，给每个 chunk 打分：

```ts
score: cosineSimilarity(queryVector, chunkVector)
```

第六步，排序并截取 Top K：

```ts
.sort((a, b) => b.score - a.score)
.slice(0, topK)
```

当前是 O(n) 线性搜索。如果有 1000 个文本块，就计算 1000 次相似度。这样最容易理解，也足以应对当前规模。IVF 或 HNSW 属于数据量增大后的性能优化。

## 8. KnowledgeBase 如何组织两种检索

统一入口位于 `src/main/rag/knowledge-base.ts`。

向量检索成功时返回：

```ts
{
  mode: "vector",
  model: "qwen3-embedding:4b",
  results: [...]
}
```

如果 Ollama 未启动、模型不存在或向量非法，则捕获错误并执行现有关键词检索：

```ts
{
  mode: "keyword-fallback",
  results: [...],
  warning: "Cannot connect to Ollama ..."
}
```

这不是混合检索。

```text
当前实现：向量成功就只用向量；向量失败才用关键词
混合检索：每次同时运行向量和关键词，再融合两个分数
```

`search()` 现在返回 Promise，因为 HTTP 调用是异步操作：

```ts
const response = await knowledgeBase.search(query, topK);
```

Python 类比：

```python
response = await knowledge_base.search(query, top_k)
```

## 9. RAG 如何通过 Tool 进入 Agent Loop

工具定义位于 `src/main/tools/built-in-tools.ts`。

完整调用链：

```text
用户提问
-> DeepSeek 返回 search_knowledge tool_call
-> Agent Loop 找到 ToolRegistry 中的 search_knowledge
-> tool.execute(args)
-> KnowledgeBase.search()
-> VectorRetriever.retrieve()
-> Ollama /api/embed
-> 返回相关 KnowledgeChunk
-> 工具结果加入 messages
-> DeepSeek 再次调用
-> 生成最终回答
```

工具输出包含：

```text
retrieval_mode: vector
embedding_model: qwen3-embedding:4b
```

如果回退，则包含：

```text
retrieval_mode: keyword-fallback
warning: 具体错误原因
```

这些字段用于判断 RAG 是否真的执行，避免只看最终答案时误以为模型调用了知识库。

## 10. 如何测试

普通自动测试：

```cmd
npm test
```

它使用 Fake Provider 和模拟 `fetch`，不会连接 Ollama。它验证接口、数学、索引、增量向量化、错误回退和工具输出。

真实模型测试：

```cmd
npm run test:embedding
```

它会实际调用：

```text
qwen3-embedding:4b
```

并输出：

```text
provider
model
dimensions
related_similarity
unrelated_similarity
semantic comparison
```

完整构建：

```cmd
npm run typecheck
npm run build
```

Electron 手动测试：

```cmd
npm run dev:electron
```

提问：

```text
请搜索知识库，Agent 是怎样注册和执行工具的？
```

在 Agent 事件中检查 `search_knowledge` 工具结果是否包含 `retrieval_mode: vector`。

## 11. 当前版本仍缺少什么

Phase 6B 已经有真实向量检索，但还不是完整生产版 RAG。

当前缺少：

```text
向量持久化
模型元数据
应用重启后复用索引
模型变化检测和重建索引
用户文件导入
文档更新和删除
BM25
向量与关键词混合排序
Reranker
大规模近似向量索引
Embedding 设置界面
```

Phase 6C 的重点是持久化：保存原始文本块、向量、Provider、模型名称、维度和索引版本。只有这些元数据一致时，旧向量才能继续使用。
