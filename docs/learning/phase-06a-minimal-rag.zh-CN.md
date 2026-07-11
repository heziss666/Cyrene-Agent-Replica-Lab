# Phase 6A：最小 RAG 基础版

## 这一阶段解决什么问题

前面我们已经实现了：

```text
用户发消息
-> Electron renderer
-> preload
-> main IPC
-> runToolAgent
-> 模型可能调用工具
-> 工具结果回填给模型
-> 模型回复
```

但这些能力还没有解决一个重要问题：

```text
Agent 怎么查询自己本地的资料？
```

RAG 就是解决这个问题的。

RAG 的全称是 Retrieval-Augmented Generation，也就是：

```text
Retrieval = 先检索资料
Augmented = 把资料补充给模型
Generation = 模型再基于资料生成回答
```

如果不用 RAG，模型只能依赖：

```text
1. 训练时学到的知识
2. 当前 messages 里已有的上下文
3. 工具实时返回的信息
```

如果用了 RAG，Agent 就可以多一个能力：

```text
从本地知识库中找相关片段，再交给模型阅读
```

Phase 6A 先做最小版本，不接 embedding，也不接 Ollama。目标是先把 RAG 的骨架看懂。

---

## RAG 的最小数据流

这一阶段的数据流是：

```text
默认知识文档
-> KnowledgeDocument
-> chunkDocument()
-> KnowledgeChunk[]
-> KnowledgeStore
-> searchChunksByKeyword()
-> KnowledgeSearchResult[]
-> search_knowledge 工具返回文本
-> 模型基于工具结果回答
```

用 Python 类比，大概像这样：

```python
docs = [
    {"title": "ToolRegistry", "text": "..."},
]

chunks = chunk_documents(docs)
store = KnowledgeStore(chunks)

def search_knowledge(query):
    results = keyword_search(query, store.chunks)
    return format_results(results)
```

这就是最小 RAG。

---

## document / chunk / search result 分别是什么

代码位置：

```text
src/main/rag/rag-types.ts
```

### KnowledgeDocument

`KnowledgeDocument` 表示一整篇资料。

例如：

```ts
{
  id: "seed_tool_registry",
  title: "ToolRegistry",
  source: "seed",
  text: "ToolRegistry stores enabled tools..."
}
```

它类似 Python 里的：

```python
document = {
    "id": "seed_tool_registry",
    "title": "ToolRegistry",
    "source": "seed",
    "text": "ToolRegistry stores enabled tools...",
}
```

### KnowledgeChunk

`KnowledgeChunk` 表示文档切出来的小片段。

为什么要切块？

因为真实文档可能很长，不能每次都把整篇文档塞给模型。RAG 通常先把文档切成小块，检索时只找最相关的几块。

一个 chunk 包含：

```text
id          chunk 自己的 id
documentId  来源文档 id
title       来源文档标题
text        chunk 内容
source      来源类型
index       这是文档中的第几个 chunk
metadata    可选附加信息
```

### KnowledgeSearchResult

`KnowledgeSearchResult` 表示一次检索命中的结果。

它包含：

```text
chunk         命中的文本块
score         分数
matchedTerms  命中的关键词
```

注意：检索结果不是模型回答。它只是“找到的资料”。

---

## chunk-text.ts 如何切块

代码位置：

```text
src/main/rag/chunk-text.ts
```

核心函数：

```ts
chunkDocument(document, options)
```

它做的事情很简单：

```text
1. 检查 chunkSizeChars 和 overlapChars 是否合理
2. 去掉文档首尾空白
3. 如果文本为空，返回 []
4. 按固定字符窗口切块
5. 每个 chunk 保留 documentId / title / source 等来源信息
```

默认配置：

```text
chunkSizeChars = 600
overlapChars = 120
```

假设文本长度是 1500：

```text
chunk 0: 0-600
chunk 1: 480-1080
chunk 2: 960-1500
```

为什么第二块从 480 开始，而不是 600？

因为 overlap 是 120：

```text
下一块起点 = 上一块起点 + chunkSize - overlap
下一块起点 = 0 + 600 - 120 = 480
```

overlap 的作用是防止重要信息刚好被切断。

例如：

```text
... Agent 通过 ToolRegistry
调用工具 ...
```

如果边界正好在 `ToolRegistry` 附近，没有 overlap，检索效果可能变差。有 overlap 时，边界附近内容会出现在两个 chunk 里。

---

## keyword-retriever.ts 如何打分

代码位置：

```text
src/main/rag/keyword-retriever.ts
```

核心函数：

```ts
extractSearchTerms(query)
searchChunksByKeyword(query, chunks, options)
```

### extractSearchTerms

它把用户问题拆成检索词。

例如：

```ts
extractSearchTerms("RAG Phase 6A 知识库 检索")
```

结果：

```ts
["rag", "phase", "6a", "知识库", "检索"]
```

这里没有使用复杂中文分词，只用正则提取：

```text
英文/数字连续片段
中文连续片段
```

这是一个学习版实现，简单但可控。

### searchChunksByKeyword

它给每个 chunk 打分。

规则：

```text
标题命中：每次 +3
正文命中：每次 +1
```

为什么标题更高？

因为标题通常代表文档主题。比如用户问 `RAG`，标题叫 `Minimal RAG` 的 chunk 应该优先于正文里偶然出现一次 `rag` 的 chunk。

### 中英文小同义词

项目里经常中英文混写，所以检索器加了一个很小的同义词表：

```text
工具 <-> tool / tools
```

这意味着用户搜“工具”时，也能命中英文文档里的 `tools`。

这不是完整翻译系统，只是为了让学习项目里的常见词更容易命中。

---

## knowledge-store.ts 和 knowledge-base.ts 的区别

### knowledge-store.ts

代码位置：

```text
src/main/rag/knowledge-store.ts
```

它只负责存 chunk。

接口：

```ts
addDocument(document)
getChunks()
clear()
```

它不关心用户 query，也不负责打分。

用 Python 类比：

```python
class KnowledgeStore:
    def __init__(self):
        self.chunks = []

    def add_document(self, doc):
        self.chunks.extend(chunk_document(doc))

    def get_chunks(self):
        return copy(self.chunks)
```

当前阶段是内存存储，所以程序重启后不会保留资料。这是有意设计：先学懂 RAG 骨架，再做磁盘持久化。

### knowledge-base.ts

代码位置：

```text
src/main/rag/knowledge-base.ts
```

它负责把 store 和 retriever 组合起来。

接口：

```ts
addDocument(input)
search(query, topK)
clear()
```

区别可以这样理解：

```text
KnowledgeStore = 仓库，只负责存放 chunk
KnowledgeBase = 服务入口，负责添加文档和搜索文档
```

---

## search_knowledge 工具如何进入 Agent Loop

代码位置：

```text
src/main/rag/default-knowledge.ts
src/main/tools/built-in-tools.ts
```

### default-knowledge.ts

这里创建默认知识库。

现在有三篇 seed document：

```text
Cyrene Agent Replica Lab Overview
ToolRegistry
Minimal RAG
```

这些文档让你不需要先做导入 UI，也能测试 RAG 工具。

### built-in-tools.ts

这里新增了工具：

```text
search_knowledge
```

它的参数是：

```ts
{
  query: string;
  topK?: number;
}
```

它的执行流程是：

```text
execute(args)
-> 取出 query 和 topK
-> knowledgeBase.search(query, topK)
-> 把结果格式化成文本
-> 返回给 Agent loop
```

然后现有的工具调用循环会继续做：

```text
工具结果
-> 作为 tool message 加回 messages
-> 再调用模型
-> 模型生成最终回答
```

所以 `search_knowledge` 和 `calculator` 的本质一样：

```text
它们都是 ToolRegistry 里的工具。
区别只是 calculator 计算数字，search_knowledge 查询资料。
```

---

## 和源项目 RAG 的区别

源项目的 RAG 更复杂，包含：

```text
embedding.ts
vectorstore.ts
retriever.ts
reranker.ts
file-ingest.ts
worldbook.ts
```

学习版 Phase 6A 只做：

```text
rag-types.ts
chunk-text.ts
knowledge-store.ts
keyword-retriever.ts
knowledge-base.ts
default-knowledge.ts
```

对应关系：

```text
chunk-text.ts        -> 源项目 chunk.ts 的简化版
knowledge-store.ts   -> 源项目 vectorstore.ts 的前置简化版
keyword-retriever.ts -> 源项目 retriever.ts 的关键词检索前置版
knowledge-base.ts    -> 源项目 rag/index.ts 的简化入口
```

最大区别：

```text
Phase 6A 没有 embedding，也没有向量检索。
```

这意味着它不能很好理解同义表达。

例如：

```text
用户问：如何让 Agent 查资料？
文档写：retrieval augmented generation
```

关键词检索可能搜不到，因为字面词不同。embedding 检索会更擅长这种语义相似。

---

## 下一步为什么要接 embedding

关键词检索的优点是简单：

```text
代码少
可测试
不依赖外部服务
容易理解
```

但它有明显缺点：

```text
同义词弱
中文分词弱
语义理解弱
表达换一种说法就可能搜不到
```

embedding 的作用是把文本变成向量。

例如：

```text
"工具调用"
"function calling"
"让模型使用外部函数"
```

这些字面不同，但语义接近。embedding 后，它们的向量距离可能更近。

Phase 6B 会在现在的骨架上继续加：

```text
EmbeddingProvider
Ollama embedding
cosine similarity
JSON vector store
vector search
```

到那时你会更容易理解：

```text
为什么需要 embedding
为什么要存向量
为什么要算相似度
为什么源项目还要做 hybrid retriever
```

因为 Phase 6A 已经把 RAG 的基本流程先跑通了。
