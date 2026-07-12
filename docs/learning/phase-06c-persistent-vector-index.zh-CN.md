# Phase 6C：持久化向量索引学习文档

Phase 6B 已经能用 Ollama 把知识块和问题变成向量，但索引只在进程内存中。本阶段把“可复用的文档向量”保存为经过校验的 JSON 文件；查询向量仍然按每个问题即时生成。

本文持续使用同一个真实种子块。`DEFAULT_CHUNK_SIZE_CHARS` 为 600，而 ToolRegistry 种子文本只有 202 个字符，因此它生成一个完整块：

```text
chunkId  = seed_tool_registry_chunk_0
textHash = 5d480cb2f57488f18282af5c3dbfe85c63a6642420ae84fc2074579db672fefa
```

该哈希是下列 UTF-8 文本的 SHA-256：`ToolRegistry stores enabled tools, exposes their JSON schemas to the model, and executes tool calls requested by the model. Built-in tools currently include time, calculator, echo, and search_knowledge.`

## 1. 为什么 Phase 6B 每次重启都要重新向量化？

**代码：** `src/main/rag/in-memory-vector-index.ts`、`src/main/rag/vector-retriever.ts`

Phase 6B 的索引是一个进程内 `Map`。应用退出后，Map 和其中的 2560 维文档向量都会消失；下次 `retrieve()` 看不到条目，便再次调用 Ollama 的 `embedDocuments()`。Phase 6C 保留内存实现给快速测试，同时以 JSON 实现替换默认运行时索引。

```ts
const entries = new Map<string, VectorIndexEntry>();
const missing = indexedChunks.filter(
  ({ chunk, textHash }) => !index.has(chunk.id, textHash),
);
```

Python 对照：普通字典和 Python 进程同寿命，除非显式写盘。

```python
entries: dict[str, Entry] = {}
missing = [c for c in chunks if not index.has(c.id, sha256(c.text))]
```

## 2. 持久化索引在完整 RAG 流程中的位置

**代码：** `src/main/rag/default-knowledge.ts`、`src/main/rag/vector-retriever.ts`、`src/main/tools/built-in-tools.ts`

文档索引路径和查询路径不同：首次或内容变化时，`VectorRetriever` 将缺失的块批量发送给 `embedDocuments()`，随后写入索引；每次用户问题只调用 `embedQuery()`。工具把最终结果格式化给 Agent，包含诊断头部。

```text
种子文档 -> chunkDocument -> 文档向量 -> VectorIndex -> vector-index.json
用户问题 -> embedQuery -> cosineSimilarity -> search_knowledge 工具输出
```

```ts
const header = [
  `retrieval_mode: ${response.mode}`,
  response.model ? `embedding_model: ${response.model}` : undefined,
];
```

Python 对照：可把磁盘索引理解成文档向量的缓存；它不缓存每一次用户提问的临时向量。

```python
document_vectors = disk_index.load_or_build(chunks)
query_vector = await provider.embed_query(question)
```

## 3. VectorIndex 接口为什么必须独立？

**代码：** `src/main/rag/vector-index-types.ts`、`src/main/rag/in-memory-vector-index.ts`、`src/main/rag/json-vector-index.ts`

`VectorRetriever` 只知道“索引能初始化、读写、裁剪和清空”，不知道 JSON、文件路径或 Node 文件系统。这使内存索引和磁盘索引能替换，测试也能注入安全的内存版本。

```ts
export interface VectorIndex {
  initialize(): Promise<VectorIndexLoadResult>;
  has(chunkId: string, textHash: string): boolean;
  get(chunkId: string, textHash: string): number[] | undefined;
  addMany(entries: VectorIndexEntry[]): Promise<void>;
  prune(validEntries: VectorIndexEntryKey[]): Promise<number>;
  clear(): Promise<void>;
}
```

Python 对照：这是 `Protocol`，而不是让检索器依赖某个 JSON 类。

```python
class VectorIndex(Protocol):
    async def initialize(self) -> LoadResult: ...
    def has(self, chunk_id: str, text_hash: str) -> bool: ...
    def get(self, chunk_id: str, text_hash: str) -> Optional[list[float]]: ...
```

检索器在 `has()` 判断和缺失块索引完成后调用 `get()`，取得索引返回的防御性向量副本，再用于余弦相似度计算。

## 4. chunkId 与 textHash 为什么必须共同判断？

**代码：** `src/main/rag/text-hash.ts`、`src/main/rag/vector-retriever.ts`、`src/main/rag/in-memory-vector-index.ts`

`chunkId` 说明“这是哪一个位置的块”，却不能说明文本仍未改变。例如同一个 `seed_tool_registry_chunk_0` 可能被编辑；只按 ID 复用就会拿到旧语义。`hashText()` 对 UTF-8 内容求 SHA-256，`has()` 只有在 ID 对应条目的 hash 也相等时才返回 true。

```ts
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

return entries.get(chunkId)?.textHash === textHash;
```

Python 对照：

```python
def has(chunk_id: str, text_hash: str) -> bool:
    return entries.get(chunk_id, {}).get("textHash") == text_hash
```

因此示例块只有同时满足 ID 为 `seed_tool_registry_chunk_0` 且 hash 为 `5d480c...72fefa` 才可复用；改动一个字符会得到新 hash，并被重新向量化。

## 5. vector-index.json 每一个字段的含义

**代码：** `src/main/rag/vector-index-types.ts`、`src/main/rag/json-vector-index.ts`

文件有三层身份信息和若干条目。真实 Ollama 烟雾测试期望 `qwen3-embedding:4b` 返回 2560 维向量，所以一个条目的 `vector` 有 2560 个有限数字；下例仅截取首尾，省略号不属于实际文件。

```json
{
  "schemaVersion": 1,
  "embedding": {
    "providerId": "ollama",
    "model": "qwen3-embedding:4b",
    "dimensions": 2560
  },
  "chunking": { "chunkSizeChars": 600, "overlapChars": 120 },
  "entries": [{
    "chunkId": "seed_tool_registry_chunk_0",
    "textHash": "5d480cb2f57488f18282af5c3dbfe85c63a6642420ae84fc2074579db672fefa",
    "vector": [0.021, -0.137, "... 2556 more finite numbers ...", 0.084]
  }]
}
```

`schemaVersion` 表示文件格式；`embedding` 防止混用提供者、模型和维度；`chunking` 说明 ID 所代表的切块方式；`entries` 是可重用的内容身份和向量。

Python 对照：`dict` 对应 JSON 对象，`list[float]` 对应 2560 维 `vector`。

```python
entry = {"chunkId": chunk_id, "textHash": digest, "vector": vector_2560}
```

## 6. initialize 如何区分 missing、loaded、incompatible 和 corrupt？

**代码：** `src/main/rag/json-vector-index.ts`、`src/main/rag/vector-index-types.ts`

`initialize()` 缓存同一个 Promise，避免并发调用各自读取或恢复文件。不存在文件是正常首次运行；成功且兼容的文件才加载到 Map；格式正确但身份不匹配的文件不复用；无法解析或违反结构约束的文件会备份后重建。

```ts
export type VectorIndexLoadStatus =
  | "missing" | "loaded" | "incompatible" | "corrupt";

initializationPromise ??= load();
return initializationPromise;
```

Python 对照：

```python
if self._initialization is None:
    self._initialization = self._load()
return await self._initialization
```

`missing` 的日志是 `[RAG] vector index missing`；`loaded` 会报告条目数。`incompatible` 是安全地忽略旧文件，`corrupt` 是先保留坏文件证据再从空索引开始。

## 7. JsonVectorIndex 如何验证磁盘数据？

**代码：** `src/main/rag/json-vector-index.ts`、`src/main/rag/vector-math.ts`

磁盘 JSON 是不可信输入。加载时先要求 plain object 和整数 schema，再验证 provider/model 字符串、正整数 dimensions、非负 overlap、entries 数组、唯一 `chunkId`，以及每个非空有限向量。最后每条向量长度必须等于 `embedding.dimensions`。

```ts
const entries = assertEntryArray(file.entries);
validateDimensions(entries, dimensions);

validateVector(vector, `Invalid vector index: ${label}`);
```

Python 对照：应在反序列化边界检查类型和值，而不是假设 `json.load()` 的结果可信。

```python
if not isinstance(raw["entries"], list):
    raise ValueError("Invalid vector index: entries must be an array")
if any(not math.isfinite(x) for x in vector):
    raise ValueError("non-finite vector")
```

这层检查也阻止重复 ID、空向量和 2560 维声明配上 1024 个数字之类的静默错误。

## 8. addMany 为什么只保存一次文件？

**代码：** `src/main/rag/vector-retriever.ts`、`src/main/rag/json-vector-index.ts`

检索器先收集所有缺失块，用一次 `embedDocuments()` 取得同数量向量，再用一次 `addMany()` 提交整个批次。JSON 索引先验证整个批次、更新 Map、设置维度，最后只调用一次 `save()`，不会每个块各写一次磁盘。

```ts
const vectors = await provider.embedDocuments(missing.map(({ chunk }) => chunk.text));
await index.addMany(missing.map(({ chunk, textHash }, i) => ({
  chunkId: chunk.id, textHash, vector: vectors[i],
})));
```

```ts
for (const entry of parsedEntries) entries.set(entry.chunkId, cloneEntry(entry));
dimensions = nextDimensions;
await save();
```

Python 对照：先构造一个批次，再一次性落盘。

```python
entries.update({item.chunk_id: item for item in batch})
await save_once(entries)
```

首次检索三个默认种子块时，预期是一批 3 个文档向量和一条 `[RAG] vector index saved: 3 entries` 日志。

## 9. prune 如何处理新增、修改和删除的文本块？

**代码：** `src/main/rag/vector-retriever.ts`、`src/main/rag/json-vector-index.ts`

每次有效检索先为当前 chunks 计算 `(chunkId, textHash)` 清单并 `prune()`。不存在于清单中的旧条目被删除；同 ID 但 hash 已变的条目也被删除。之后 `missing` 会把新增或修改后的块送去向量化，未变块则直接复用。

```ts
await index.prune(indexedChunks.map(({ chunk, textHash }) => ({
  chunkId: chunk.id, textHash,
})));

if (valid.get(chunkId) !== entry.textHash) entries.delete(chunkId);
```

Python 对照：

```python
valid = {c.id: sha256(c.text) for c in chunks}
entries = {id: e for id, e in entries.items() if valid.get(id) == e.text_hash}
```

例如重启后 `keep` 保持原文、`change` 文本变化、`remove` 不再出现：只为 `change` 调用嵌入，`remove` 会从 JSON 删除，最终仅保留 `keep` 和 `change`。

## 10. 原子写入和 Windows 备份恢复流程

**代码：** `src/main/rag/atomic-file-write.ts`

先在目标文件同目录写 `vector-index.json.tmp`，再尝试直接把 tmp 重命名为正式文件。这样同一文件系统内的重命名可替换整个文件。Windows 可能因句柄或权限让替换返回 `EPERM`、`EACCES` 或 `EEXIST`；此时先把正式文件改名为 `.bak`，再把 tmp 升为正式文件。第二步失败则立即把 `.bak` 还原。

```ts
await fileOps.rename(filePath, backupPath);
try {
  await fileOps.rename(temporaryPath, filePath);
} catch (error) {
  await fileOps.rename(backupPath, filePath);
  throw error;
}
```

Python 对照：重点是永远不在已有正式文件尚未备份时删除它。

```python
os.replace(index_path, backup_path)
try:
    os.replace(tmp_path, index_path)
except Exception:
    os.replace(backup_path, index_path)
    raise
```

成功后删除 `.bak`；无论如何都会清理 `.tmp`。损坏文件恢复使用不同的 `vector-index.corrupt-<timestamp>.json`，便于保留诊断证据。

## 11. VectorRetriever 如何复用旧向量？

**代码：** `src/main/rag/vector-retriever.ts`

它先 `await index.initialize()`，再用 hash-aware 的 `has()` 筛出缺失块。跨进程时新的 `JsonVectorIndex` 会从 JSON 加载 Map；若 `seed_tool_registry_chunk_0` 的完整 ID 和 `5d480c...72fefa` 都相同，就不调用 `embedDocuments()`，但仍调用 `embedQuery()` 处理新问题。

```ts
const vector = index.get(chunk.id, textHash);
if (!vector) throw new Error(`Missing vector for chunk: ${chunk.id}`);
return { chunk, score: cosineSimilarity(queryVector, vector) };
```

Python 对照：

```python
vector = index.get(chunk.id, digest)
if vector is None:
    raise RuntimeError(f"Missing vector for chunk: {chunk.id}")
score = cosine_similarity(query_vector, vector)
```

排序按分数降序；分数相同再按 `chunk.id.localeCompare()`，让结果稳定。当前是逐条比较的 O(n) 精确检索。

## 12. KnowledgeBase 为什么仍然保留关键词回退？

**代码：** `src/main/rag/knowledge-base.ts`、`src/main/rag/keyword-retriever.ts`

磁盘不可写、索引损坏恢复失败、Ollama 离线或返回无效向量时，知识库不能让整个 Agent 失去本地知识。它捕获向量检索错误，改用已有关键词检索，并把原错误放进 `warning`，而不是伪装成成功的向量检索。

```ts
try {
  return { mode: "vector", model: options.vectorRetriever.model,
    results: await options.vectorRetriever.retrieve(query, chunks, topK) };
} catch (error) {
  return { mode: "keyword-fallback", results: searchChunksByKeyword(query, chunks, { topK }),
    warning: error instanceof Error ? error.message : String(error) };
}
```

Python 对照：

```python
try:
    return vector_results()
except Exception as error:
    return keyword_results(warning=str(error))
```

`KnowledgeBase.clear()` 也先清内存知识，再等待 `vectorRetriever.clear()` 删除持久化索引；而 Electron 的“New Chat”只调用 `ChatSession.clear()` 重置对话历史，不会清知识索引。

## 13. 默认存储目录与 CYRENE_RAG_DATA_DIR

**代码：** `src/main/config/rag-storage-config.ts`、`src/main/rag/default-knowledge.ts`

默认目录来自 Node 的 `homedir()`：`~/.cyrene-agent-replica-lab/rag/vector-index.json`。若设定 `CYRENE_RAG_DATA_DIR`，代码先 `trim()` 再 `resolve()`，所以可以把手动验证或测试隔离到临时目录。

```ts
const dataDir = override
  ? resolve(override)
  : join(homeDir, ".cyrene-agent-replica-lab", "rag");
return { dataDir, vectorIndexPath: join(dataDir, "vector-index.json") };
```

Python 对照：

```python
data_dir = Path(os.environ.get("CYRENE_RAG_DATA_DIR", "").strip()).resolve() \
    if os.environ.get("CYRENE_RAG_DATA_DIR", "").strip() else home / ".cyrene-agent-replica-lab" / "rag"
```

默认装配把该路径、嵌入提供者的 `id/model` 和 `600/120` 切块配置传给 `createJsonVectorIndex()`。

## 14. 如何读懂单元测试和跨实例持久化测试？

**代码：** `tests/rag/json-vector-index.test.ts`、`tests/rag/vector-index-persistence.test.ts`、`tests/rag/atomic-file-write.test.ts`、`tests/tools/built-in-tools.test.ts`

单元测试把每个边界独立开：JSON 测试覆盖 missing、loaded、incompatible、corrupt、重复 ID、维度和 clear；原子写测试用可注入的 `AtomicFileOperations` 模拟 Windows 替换失败。它们使用 `mkdtemp()` 和 fake provider，因此不访问 `127.0.0.1:11434`，也不写真实主目录。

```ts
const secondEmbedDocuments = vi.fn(async () => {
  throw new Error("document embeddings should have been reused");
});
expect(secondEmbedDocuments).not.toHaveBeenCalled();
```

这段跨实例测试的关键在于第二个 retriever 和第二个 JSON index 都是新对象，却读同一个临时文件；若错误地重新嵌入，测试会立即失败。

Python 对照：

```python
second_provider.embed_documents = AsyncMock(side_effect=AssertionError("must reuse"))
await second_retriever.retrieve("second query", unchanged_chunks)
second_provider.embed_documents.assert_not_awaited()
```

工具测试则注入 fake provider 和临时 `storageConfig`，确认输出含 `retrieval_mode: vector` 与 `embedding_model: fake-model`，并验证实际文件包含 schema。

## 15. 如何手动观察首次索引与重启复用？

**代码：** `src/main/config/rag-storage-config.ts`、`src/main/rag/json-vector-index.ts`、`src/main/tools/built-in-tools.ts`

在 Windows 命令提示符中选一个临时目录，以免碰到真实用户数据：

```cmd
set CYRENE_RAG_DATA_DIR=%TEMP%\cyrene-rag-phase6c-manual
npm run dev:electron
```

让模型调用 `search_knowledge`，可发送：

```text
请搜索知识库并说明 Agent 是怎样注册和执行工具的。
```

第一次成功的工具调用应使终端出现 `[RAG] vector index missing` 和 `[RAG] vector index saved: 3 entries`；工具结果应包含：

```text
retrieval_mode: vector
embedding_model: qwen3-embedding:4b
```

关闭 Electron 后，以同一环境变量再次启动并重复问题。若文本、模型和切块配置都未变，应看到 `[RAG] vector index loaded: 3 entries`，且不再为三个文档块嵌入。最后检查 `%TEMP%\cyrene-rag-phase6c-manual\vector-index.json`：应有 `schemaVersion`、`embedding`、`chunking`、各条目的 hash 和 2560 个数字的 vector。这里“工具调用成功”还依赖本机可用的模型服务和聊天模型配置；界面本身不应被自动脚本伪造为人工验证。

Python 对照：同一 `data_dir` 的第二个进程应走 `load()`，不是 `build()`。

```python
first = JsonIndex(path); await first.add_many(entries)
second = JsonIndex(path); assert (await second.initialize()).status == "loaded"
```

## 16. 当前 JSON 方案的限制与 Phase 6D 方向

**代码：** `src/main/rag/vector-retriever.ts`、`src/main/rag/json-vector-index.ts`、`src/main/rag/vector-math.ts`

这是一套清晰、可教学、适合少量本地种子数据的实现，不是大型向量数据库。JSON 会完整载入内存；每次变更都重写整个文件；检索对每个块计算余弦相似度，是 O(n)。当前没有文档导入界面、并发多进程协调、ANN/HNSW、BM25/混合排序、reranker 或迁移器。

```ts
return indexedChunks
  .map(({ chunk, textHash }) => ({ chunk, score: cosineSimilarity(queryVector, index.get(chunk.id, textHash)!) }))
  .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
  .slice(0, topK);
```

Python 对照：这与对所有向量做一次线性扫描相同。

```python
top = sorted(((cosine(query, v), chunk) for chunk, v in entries), reverse=True)[:top_k]
```

Phase 6D 可以先在不破坏 `VectorIndex` 抽象的前提下加入用户文档生命周期和更明确的 schema migration；数据量增长后，再评估 SQLite/向量数据库、近似最近邻、关键词与向量混合排序，以及重排模型。无论后端如何变化，ID + 内容 hash、兼容性检查、可恢复写入和关键词回退仍是值得保留的边界。
