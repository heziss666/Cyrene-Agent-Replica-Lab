# Phase 6A：最小 RAG 基础版设计

## 目标

Phase 6A 的目标不是一次性复刻源项目完整 RAG，而是先做一个可以完全看懂、可以测试、可以被 Agent 调用的最小 RAG。

本阶段完成后，学习版 Agent 应该具备这条能力链：

```text
准备一批本地知识文本
-> 把文本切成 chunk
-> 存进一个简单知识库
-> 根据用户问题做关键词检索
-> 通过 search_knowledge 工具把相关片段返回给模型
-> 模型根据检索结果回答
```

这一步的重点是理解 RAG 的基本数据流，而不是追求检索效果最好。

---

## 为什么不直接接 embedding

源项目的 RAG 包含：

```text
chunk.ts
embedding.ts
vectorstore.ts
retriever.ts
reranker.ts
file-ingest.ts
worldbook.ts
```

其中 `embedding + vectorstore + hybrid retriever` 是完整 RAG 的核心，但学习成本较高。

如果现在直接接 Ollama embedding，会同时出现这些概念：

```text
embedding model
向量维度
cosine similarity
JSON vector store
BM25
hybrid score
模型配置
本地服务连接失败
```

这样会让你很难判断问题到底出在 RAG 逻辑、embedding 模型、Ollama 服务，还是 Agent 工具调用。

所以 Phase 6A 先实现“无 embedding 的 RAG”：

```text
chunk + store + keyword search + tool
```

等这一层完全理解后，Phase 6B 再把关键词检索替换或扩展成 embedding 检索。

---

## 本阶段做什么

### 1. 定义 RAG 基础类型

新增：

```text
src/main/rag/rag-types.ts
```

核心类型：

```ts
export interface KnowledgeDocument {
  id: string;
  title: string;
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  title: string;
  text: string;
  source: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms: string[];
}
```

含义：

```text
KnowledgeDocument = 一整篇资料
KnowledgeChunk = 文档切出来的小片段
KnowledgeSearchResult = 检索命中的片段和分数
```

---

### 2. 实现文本切块

新增：

```text
src/main/rag/chunk-text.ts
```

它负责把长文本切成多个 chunk。

学习版先不用真实 tokenizer，而是使用字符长度近似：

```text
chunkSizeChars = 600
overlapChars = 120
```

示例：

```text
原文长度 1500 字
chunk 0: 0-600
chunk 1: 480-1080
chunk 2: 960-1500
```

为什么要 overlap：

```text
如果一句重要信息刚好跨过两个 chunk 的边界，
没有 overlap 时，两个 chunk 可能都不完整。
overlap 可以让边界附近的信息被重复保留。
```

---

### 3. 实现内存知识库

新增：

```text
src/main/rag/knowledge-store.ts
```

它负责保存文档和 chunk。

本阶段先只做内存存储，不写入磁盘。

原因：

```text
先理解 RAG 的运行机制
避免同时引入文件读写、持久化、导入管理
测试更简单
```

接口：

```ts
export interface KnowledgeStore {
  addDocument(document: KnowledgeDocument): KnowledgeChunk[];
  getChunks(): KnowledgeChunk[];
  clear(): void;
}
```

本阶段不会做：

```text
删除单个文档
磁盘持久化
导入 PDF / Word / Markdown 文件
去重
```

这些留到后续 RAG 扩展阶段。

---

### 4. 实现关键词检索器

新增：

```text
src/main/rag/keyword-retriever.ts
```

检索器输入：

```text
query
chunks
topK
```

输出：

```text
按分数排序的 KnowledgeSearchResult[]
```

学习版的关键词检索规则：

```text
1. 把 query 转成小写
2. 提取英文、数字、中文连续片段
3. 对每个 chunk 计算命中次数
4. 标题命中加权
5. 分数高的排前面
```

它不是完整 BM25，但足够让你理解：

```text
检索器不是模型
检索器只是从资料库里找相关文本
找到的文本再交给模型阅读
```

---

### 5. 实现 RAG 服务入口

新增：

```text
src/main/rag/knowledge-base.ts
```

它把 store 和 retriever 组合起来。

接口：

```ts
export interface KnowledgeBase {
  addDocument(input: {
    title: string;
    text: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }): KnowledgeChunk[];

  search(query: string, topK?: number): KnowledgeSearchResult[];

  clear(): void;
}
```

它相当于 Python 里常见的封装类：

```python
class KnowledgeBase:
    def add_document(...):
        ...

    def search(...):
        ...
```

---

### 6. 新增 search_knowledge 工具

修改：

```text
src/main/tools/built-in-tools.ts
```

新增工具：

```text
search_knowledge
```

参数：

```ts
{
  query: string;
  topK?: number;
}
```

返回格式：

```text
[1] title
source: seed
score: 3
content:
...

[2] title
source: seed
score: 1
content:
...
```

这个工具的意义：

```text
Agent 本身不直接知道知识库内容
模型看到工具 schema 后，可以请求调用 search_knowledge
main 进程执行工具
工具把检索片段返回给模型
模型再基于这些片段回答用户
```

---

## 默认知识内容

为了让你不需要先做导入 UI，本阶段会在代码里准备少量 seed documents。

例如：

```text
Cyrene Agent Replica Lab 是一个用于学习 Agent 开发的 TypeScript/Electron 项目。
当前已经实现了 OpenAI-compatible 模型调用、工具调用、事件流、Electron UI 和多轮会话。
```

这样你可以直接问：

```text
这个项目目前实现了哪些模块？
```

模型应该有机会调用 `search_knowledge` 并根据资料回答。

---

## 数据流

完整流程：

```text
应用启动
  -> createDefaultToolRegistry()
  -> createDefaultKnowledgeBase()
  -> 注册 search_knowledge 工具

用户发送问题
  -> runToolAgent()
  -> 模型看到 search_knowledge 工具
  -> 模型返回 tool_call
  -> ToolRegistry 执行 search_knowledge
  -> KnowledgeBase.search(query)
  -> KeywordRetriever 对 chunks 打分
  -> 工具结果回填 messages
  -> 再次调用模型
  -> 模型生成最终回答
```

---

## 和源项目的对应关系

| 学习版 Phase 6A | 源项目 |
| --- | --- |
| `chunk-text.ts` | `src/main/rag/chunk.ts` |
| `knowledge-store.ts` | `src/main/rag/vectorstore.ts` 的简化前置版本 |
| `keyword-retriever.ts` | `src/main/rag/retriever.ts` 的关键词部分简化版 |
| `knowledge-base.ts` | `src/main/rag/index.ts` 的简化入口 |
| `search_knowledge` 工具 | 源项目里 RAG/记忆检索能力进入 Agent 的工具化路径 |

---

## 本阶段不做什么

Phase 6A 不做：

```text
embedding
Ollama 接入
cosine similarity
JSON vector store
BM25
hybrid retriever
reranker
文件导入 UI
RAG 持久化
长期记忆
worldbook
```

这些不是放弃，而是拆到后面的 Phase 6B、6C 和 Phase 7。

---

## 测试策略

新增测试：

```text
tests/rag/chunk-text.test.ts
tests/rag/keyword-retriever.test.ts
tests/rag/knowledge-base.test.ts
tests/tools/built-in-tools.test.ts
```

测试重点：

```text
长文本是否会被切成多个 chunk
overlap 是否保留边界内容
关键词检索是否能把相关 chunk 排在前面
空 query 是否返回空结果
search_knowledge 工具是否返回可读文本
默认工具注册表是否包含 search_knowledge
```

---

## 验收方式

自动验证：

```text
npm test
npm run typecheck
npm run build
```

手动验证：

```text
npm run dev:electron
```

然后在 Electron 界面问：

```text
请查一下知识库，这个学习版 Agent 目前实现了什么？
```

预期现象：

```text
Agent Events 中能看到 search_knowledge 工具被调用
最终回答里能引用知识库中的项目说明
```

---

## 设计取舍

本阶段选择“关键词 RAG”而不是“向量 RAG”。

好处：

```text
代码少
概念清楚
测试稳定
不依赖本地 Ollama 服务
可以直接复用现有 ToolRegistry
```

代价：

```text
语义检索能力弱
同义词效果差
中文分词不够精确
```

这个取舍是有意的。Phase 6A 的目标是让你先真正理解 RAG 的骨架；等骨架清楚后，再进入 embedding，会更容易理解为什么需要向量、为什么需要 cosine similarity、为什么需要混合检索。
