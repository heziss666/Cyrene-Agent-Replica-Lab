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

`initialize()` 缓存同一个 Promise，避免并发调用各自读取或恢复文件。不存在文件是正常首次运行；成功且兼容的文件才加载到 Map；格式正确但身份不匹配的文件不复用。启动时会把正式文件和 `.bak` 作为一组状态处理：正式文件缺失时恢复备份；正式文件有效时严格退役陈旧备份；正式文件损坏时先验证 `.bak`，可用就归档坏正式文件并恢复备份，不可用就先退役备份再进入空索引重建。

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

`missing` 的日志是 `[RAG] vector index missing`；`loaded` 会报告条目数。`incompatible` 是安全地忽略旧文件，`corrupt` 是先保留坏文件证据再从空索引开始。所有日志都经过不抛异常的包装函数：自定义 logger 即使失败，也不能改变加载分类、阻止内存提交或把有效文件误判为损坏。

## 7. JsonVectorIndex 如何验证磁盘数据？

**代码：** `src/main/rag/json-vector-index.ts`、`src/main/rag/vector-math.ts`

磁盘 JSON 是不可信输入。加载时先要求 plain object 和整数 schema，再验证非空 provider/model/chunk ID、正整数 dimensions、entries 数组、唯一 `chunkId`，以及每个非空有限向量。`textHash` 必须恰好是 64 个小写十六进制字符，`overlapChars` 必须非负且严格小于 `chunkSizeChars`，最后每条向量长度必须等于 `embedding.dimensions`。构造索引时还会在运行时确认 `identity.schemaVersion === 1`，不能只依赖 TypeScript 的字面量类型。

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

检索器先收集所有缺失块，用一次 `embedDocuments()` 取得同数量向量，再用一次 `addMany()` 提交整个批次。JSON 索引先验证整个批次，再克隆当前 Map 形成 staged state；只把 staged state 保存成功后，才替换正式内存 Map 和 dimensions。这样每批只写一次磁盘，而且保存失败时 `has()` 仍看到旧状态，下一次检索不会被错误地抑制重试。

```ts
const vectors = await provider.embedDocuments(missing.map(({ chunk }) => chunk.text));
await index.addMany(missing.map(({ chunk, textHash }, i) => ({
  chunkId: chunk.id, textHash, vector: vectors[i],
})));
```

```ts
const stagedEntries = cloneEntries(entries);
for (const entry of parsedEntries) {
  stagedEntries.set(entry.chunkId, cloneEntry(entry));
}
await save(stagedEntries, nextDimensions);
entries = stagedEntries;
dimensions = nextDimensions;
```

Python 对照：先构造一个批次，再一次性落盘。

```python
staged = copy.deepcopy(entries)
staged.update({item.chunk_id: item for item in batch})
await save_once(staged)
entries = staged
```

首次检索三个默认种子块时，预期是一批 3 个文档向量和一条 `[RAG] vector index saved: 3 entries` 日志。

## 9. prune 如何处理新增、修改和删除的文本块？

**代码：** `src/main/rag/vector-retriever.ts`、`src/main/rag/json-vector-index.ts`

每次有效检索先为当前 chunks 计算 `(chunkId, textHash)` 清单并 `prune()`。不存在于清单中的旧条目被删除；同 ID 但 hash 已变的条目也被删除。`prune()` 与 `addMany()` 一样在副本上修改、保存成功后才提交；保存失败不会让内存先少掉条目。若裁剪后没有条目，运行时 dimensions 会重置，下一批可以安全采用提供者的新维度。

```ts
await index.prune(indexedChunks.map(({ chunk, textHash }) => ({
  chunkId: chunk.id, textHash,
})));

if (valid.get(chunkId) !== entry.textHash) stagedEntries.delete(chunkId);
await save(stagedEntries, persistedDimensions);
entries = stagedEntries;
dimensions = stagedEntries.size === 0 ? undefined : dimensions;
```

Python 对照：

```python
valid = {c.id: sha256(c.text) for c in chunks}
staged = {id: e for id, e in entries.items() if valid.get(id) == e.text_hash}
await save_once(staged)
entries = staged
```

例如重启后 `keep` 保持原文、`change` 文本变化、`remove` 不再出现：只为 `change` 调用嵌入，`remove` 会从 JSON 删除，最终仅保留 `keep` 和 `change`。

## 10. 原子写入和 Windows 备份恢复流程

**代码：** `src/main/rag/atomic-file-write.ts`

每个 writer 先在目标文件同目录写唯一临时文件，例如 `vector-index.json.<pid>-<uuid>.tmp`，再尝试把它重命名为正式文件。唯一名称避免同一进程内重叠保存互相覆盖临时内容。Windows 可能因句柄或权限让替换返回 `EPERM`、`EACCES` 或 `EEXIST`；进入降级流程前，必须在正式文件仍完整时严格删除旧 `.bak`。若备份退役失败，保留正式文件并抛出清楚错误；成功退役后才把正式文件改名为 `.bak`，再把本次 tmp 升为正式文件。

```ts
await retireBackup(backupPath, fileOps);
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
backup_path.unlink(missing_ok=True)  # 失败就停止，index_path 此时仍完整
os.replace(index_path, backup_path)
try:
    os.replace(tmp_path, index_path)
except Exception:
    os.replace(backup_path, index_path)
    raise
```

成功后以 best-effort 方式删除本次 `.bak` 和 tmp；清理失败不能遮蔽原始写入或替换错误，遗留物由下一次启动继续处理。启动恢复会删除旧式固定 `.tmp` 和 writer-unique tmp；若只有 `.bak` 就恢复为正式文件；若正式文件与备份同时存在，则先验证正式文件，损坏时再验证并恢复可用备份。损坏正式文件使用 `vector-index.corrupt-<timestamp>.json` 保留诊断证据。

## 11. VectorRetriever 如何复用旧向量？

**代码：** `src/main/rag/vector-retriever.ts`

它先在 retriever 的串行队列中 `await index.initialize()` 和 `prune()`，再生成当前 query vector，并与已有文档向量维度比较。若同一个 provider/model 在后续运行返回了新维度，检索器会清空旧文档向量、只重建一次全部当前文档，并复用已经生成的 query vector；重建后仍不一致才报错。维度兼容时，hash-aware 的 `has()` 只筛出真正缺失的块。

```ts
const storedVector = indexedChunks
  .map(({ chunk, textHash }) => index.get(chunk.id, textHash))
  .find((vector) => vector !== undefined);
if (storedVector && queryVector.length !== storedVector.length) {
  await index.clear();
  await prepareIndex(indexedChunks);
}

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

`retrieve()` 的完整索引同步和 `clear()` 共用同一个 promise-tail serializer，所以重叠检索不会同时 prune/save，clear 也不会穿过正在进行的保存。`JsonVectorIndex` 另有自己的 mutation serializer，保护 `addMany()`、`prune()` 和 `clear()`。排序按分数降序；分数相同再按 `chunk.id.localeCompare()`，让结果稳定。当前是逐条比较的 O(n) 精确检索。

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

单元测试把每个边界独立开：JSON 测试覆盖 missing、loaded、incompatible、corrupt、事务式失败重试、formal/backup/tmp 崩溃矩阵、损坏正式文件恢复有效备份、严格 ID/hash/chunking/schema 校验、throwing logger 隔离、维度重建和 clear；原子写测试用可注入的 `AtomicFileOperations` 模拟 Windows 替换失败、旧备份退役失败和后续重试。deferred promise 测试确定性地制造重叠 retrieve/save/clear，不依赖脆弱的计时等待。它们使用 `mkdtemp()` 和 fake provider，因此不访问 `127.0.0.1:11434`，也不写真实主目录。

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

这是一套清晰、可教学、适合少量本地种子数据的实现，不是大型向量数据库。JSON 会完整载入内存；每次变更都重写整个文件；检索对每个块计算余弦相似度，是 O(n)。serializer 只保证同一进程、同一实例边界内的顺序；系统明确不支持多个 OS 进程同时写同一个索引路径。后续进程在前一个进程退出后加载同一文件是受支持的“重启复用”，不能把它理解为多进程写协调。当前也没有文档导入界面、ANN/HNSW、BM25/混合排序、reranker 或迁移器。

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
