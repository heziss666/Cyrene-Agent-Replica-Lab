# Phase 6D 学习文档：人格、风格切换与世界观 RAG

## 1. 这一阶段解决了什么问题

Phase 6C 结束时，Agent 已经具备以下能力：

- 调用 OpenAI 兼容的聊天模型；
- 运行 Function Calling Agent Loop；
- 注册和执行工具；
- 通过 Ollama 生成文本向量；
- 使用余弦相似度检索文本块；
- 把向量索引保存到本地 JSON；
- 在 Electron 中进行多轮对话。

但是当时的 Agent 仍然使用三条教学文本和一段很短的英文 System Prompt。它能证明技术流程可以运行，却不是一个完整的“昔涟角色 Agent”。

Phase 6D 增加了三组能力：

1. **稳定人格**：身份、性格和基础语气每轮都进入 System Prompt。
2. **可切换风格**：用户可以在当前聊天中切换五种表达风格，不丢失历史消息。
3. **真实世界观 RAG**：71 个语义文档通过 Ollama 建立 87 个向量块。

本阶段只有文字聊天，没有加入语音、通话、Live2D、ASR 或 TTS。

## 2. 为什么不能把全部资料都塞进 System Prompt

角色资料分成两类：

### 2.1 每轮都必须知道的规则

例如：

- 自己是谁；
- 性格是什么；
- 回答时使用什么语气；
- 当前选择了哪种风格；
- 不能虚构自己没有的工具。

这些内容一旦缺失，角色本身就会变得不稳定，因此放入 System Prompt。

### 2.2 只在相关问题中需要的知识

例如：

- 翁法罗斯经历过什么；
- 白厄是谁；
- 《如我所书》是什么；
- 迷迷、昔涟和德谬歌是什么关系。

这些世界观资料体量更大，而且普通日常对话不需要全部读取，因此进入 RAG。

最终结构是：

```text
System Prompt
├── 当前项目真实能力规则
├── identity.md
├── soul.md
├── tone-rules.md
└── 当前选择的 style

RAG
├── canon_quotes.md
└── worldbook/*.md
```

## 3. 资源目录

导入后的资料位于：

```text
resources/cyrene/
├── LICENSE.upstream
├── ORIGIN.md
├── prompts/
│   ├── runtime-system.md
│   ├── identity.md
│   ├── soul.md
│   ├── tone-rules.md
│   ├── source/system.md
│   └── styles/
├── knowledge/
│   ├── canon_quotes.md
│   └── worldbook/
└── inactive-skills/
    └── cyrene-original-voice/
```

`source/system.md` 是源项目规则的原始快照，只用于比较学习。它没有直接启用，因为其中包含本地文件、生活工具和文档工具等尚未全部复刻的能力。

真正生效的是 `runtime-system.md`。它只声明当前 Agent 确实拥有的能力，避免模型声称自己执行了不存在的工具。

`cyrene-original-voice` 也只是未启用快照。Phase 6D 没有 Skills 调度系统，所以任何运行时代码都不会读取它。

## 4. 五种风格如何表示

风格类型定义在：

```text
src/shared/persona-types.ts
```

核心代码相当于：

```ts
const STYLE_OPTIONS = [
  { id: "default", label: "温柔和善", file: "01_default.md" },
  { id: "lively", label: "元气活泼", file: "02_lively.md" },
  { id: "healing", label: "治愈安心", file: "03_healing.md" },
  { id: "focused", label: "知性认真", file: "04_focused.md" },
  { id: "sweet", label: "撒娇黏人", file: "05_sweet.md" },
] as const;
```

这里同时保存了三个概念：

- `id`：程序和 JSON 使用的稳定标识；
- `label`：界面显示给用户的中文名称；
- `file`：需要加载的 Prompt 文件。

Renderer 传回来的值属于不可信输入，因此 Main 进程会使用 `isStyleId()` 验证。即使有人在开发者工具里直接发送 `phone`，Main 也会拒绝。

## 5. Prompt Loader 和 Prompt Composer

### 5.1 Prompt Loader

文件：

```text
src/main/prompts/prompt-loader.ts
```

它只负责读取一个必需文件：

```ts
loadRequiredPrompt(relativePath, readPrompt)
```

读取后会执行 `trim()`。文件不存在或内容为空时抛出统一错误：

```text
Required prompt file is missing or empty: styles/05_sweet.md
```

核心人格缺失时不能悄悄退回普通助手，因为那会让用户以为昔涟人格仍然生效。

### 5.2 Prompt Composer

文件：

```text
src/main/prompts/prompt-composer.ts
```

创建 Composer 时会一次性加载：

```text
4 个核心文件
+ 5 个风格文件
= 9 个 Prompt 文件
```

这叫做**启动时快速失败**。如果某个文件缺失，应用在打开聊天窗口前就能发现，而不是等用户发送第一条消息后才出错。

每轮组合顺序为：

```text
runtime-system
-> identity
-> soul
-> tone-rules
-> active style
-> temporary transition（可选）
```

## 6. 为什么 System Prompt 不再存入 ChatSession

Phase 6C 的会话结构大致是：

```ts
messages = [
  { role: "system", content: "固定 Prompt" },
  { role: "user", content: "你好" },
  { role: "assistant", content: "你好" },
];
```

固定 Prompt 没有问题，但动态风格会产生冲突。例如先后保存两个 System：

```text
System：使用默认风格
System：使用治愈风格
```

模型可能不知道应该遵守哪个。

新的 `ChatSession` 只保存真正的聊天历史：

```ts
messages = [
  { role: "user", content: "你好" },
  { role: "assistant", content: "你好" },
];
```

每次请求前，Main 临时构造：

```ts
requestMessages = [
  { role: "system", content: composeCurrentPrompt() },
  ...session.getMessages(),
];
```

模型返回后，再把所有 `system` 消息过滤掉，只把用户、助手和工具消息写回 Session。

`ChatSession.replaceMessages()` 还会主动拒绝 System 消息。这是第二层保护，防止未来修改代码时不小心把动态 Prompt 写入历史。

## 7. 风格切换为什么不会失忆

完整数据流是：

```text
用户选择“治愈安心”
    ↓
Renderer: changeSelectedStyle("healing")
    ↓
Preload: ipcRenderer.invoke(persona.setStyle)
    ↓
Main: 验证 StyleId
    ↓
原子保存 persona.json
    ↓
ChatSession.setStyle("healing")
    ↓
保留原 messages，记录 pending transition
```

会话状态类似：

```ts
{
  activeStyle: "healing",
  messages: [以前的全部聊天消息],
  pendingTransition: {
    from: "default",
    to: "healing",
  },
}
```

用户下一次发送消息时，System Prompt 最后临时加入：

```text
回复风格已从“温柔和善”切换为“治愈安心”。
继续理解并使用此前对话内容，但从本轮开始遵守新的回复风格。
```

因此模型同时得到：

- 旧对话历史，负责“记住聊过什么”；
- 新风格规则，负责“接下来怎么表达”。

模型成功回复后才执行：

```ts
session.acknowledgeStyleTransition();
```

如果模型 API 请求失败，提醒不会清除。下一次重试仍然会收到切换要求。

这条提醒不写入永久历史，因为它属于应用状态，不是用户说过的话。

## 8. 风格配置保存在哪里

默认文件：

```text
C:\Users\当前用户名\.cyrene-agent-replica-lab\persona.json
```

结构：

```json
{
  "schemaVersion": 1,
  "styleId": "healing"
}
```

保存顺序是：

```text
先写临时文件
-> 原子替换正式文件
-> 保存成功
-> 再修改内存会话风格
```

如果磁盘已满，保存失败，内存中的风格不会变化，Renderer 也会恢复原来的选择。

应用重启后只恢复风格，不恢复聊天历史。聊天历史持久化属于后续阶段。

## 9. Renderer 为什么看不到 ipcRenderer

Renderer 只能使用 Preload 暴露的：

```ts
window.cyrene.persona.getStyle()
window.cyrene.persona.setStyle(styleId)
```

它看不到：

- 原始 `ipcRenderer`；
- 任意 IPC channel；
- Prompt 文件路径；
- 文件系统 API。

因此 Renderer 不能自行发起 `delete-file` 或读取本地人格文件。它只能调用 Main 明确允许的两个风格操作。

## 10. 世界观 Markdown 如何变成向量

### 10.1 第一层：Markdown 语义章节

文件：

```text
src/main/rag/markdown-knowledge-loader.ts
```

世界书中的每个二级标题是一个语义条目：

```markdown
## 翁法罗斯之心 / PHILIA093

正文……

## 三形态同一性

正文……
```

解析后成为两个 `KnowledgeDocument`：

```ts
{
  id: "worldbook_cyrene_翁法罗斯之心-philia093",
  title: "翁法罗斯之心 / PHILIA093",
  source: "worldbook/Cyrene.md",
  text: "文件上下文 + 当前章节",
  metadata: {
    collection: "cyrene-worldbook",
    file: "Cyrene.md",
    section: "翁法罗斯之心 / PHILIA093",
  },
}
```

文档 ID 只依赖：

- 相对文件路径；
- 标题；
- 同名标题的稳定序号。

因此重启后同一章节仍然拥有相同 ID，Phase 6C 的索引可以复用。

### 10.2 第二层：长度切块

章节超过 600 个字符时，已有 `chunkDocument()` 继续切分：

```text
chunk size = 600 字符
overlap = 120 字符
```

语义章节和长度切块并不冲突：

```text
H2 Parser 负责避免不同主题混在一个文档
chunkDocument 负责避免单个主题超过模型适合处理的长度
```

### 10.3 第三层：Embedding 和索引

完整流程：

```text
6 个 Markdown 文件
    ↓
71 个 KnowledgeDocument
    ↓
87 个 KnowledgeChunk
    ↓
qwen3-embedding:4b
    ↓
87 个 2560 维向量
    ↓
JSON Vector Index
```

用户问题也由同一个模型生成 2560 维查询向量，然后通过余弦相似度排序。

## 11. canon_quotes 为什么单独处理

世界书使用 `##` 标题，但 `canon_quotes.md` 使用：

```markdown
**【道别 / 要离开的时候】**
```

`cyrene-knowledge.ts` 会先把它转换成二级标题，再交给同一个 Markdown Parser。这样“道别”“情绪低落”“邀请”等场景分别成为独立向量文档，而不是把全部台词当成一个大文本。

## 12. search_knowledge 如何使用新语料

工具接口没有变化：

```ts
{
  query: string;
  topK?: number;
}
```

变化的是 `createDefaultKnowledgeBase()` 的输入：

```text
以前：3 条 Seed 教学文本
现在：昔涟 worldbook + canon quotes
```

Agent Loop 仍然由模型决定是否调用工具。System Prompt 会提醒模型：涉及昔涟世界观时先使用 `search_knowledge`。

## 13. 冷启动和热启动是什么意思

命令：

```cmd
npm run rag:benchmark
```

基准使用临时目录，不会覆盖用户正常索引。

### 冷启动

索引文件不存在，需要：

```text
读取文档
-> 切块
-> Ollama 生成 87 个文档向量
-> 保存 JSON
-> 执行查询
```

### 热启动

索引已经存在，只需要：

```text
验证索引身份和语料哈希
-> 加载 87 个向量
-> 只生成查询向量
-> 检索
```

本机 `qwen3-embedding:4b` 实测：

```text
Markdown files: 6
Documents: 71
Chunks: 87
Vector dimensions: 2560
Index bytes: 4,832,400
Cold build: 37,690.7 ms
Warm load: 257.8 ms
Average query: 206.8 ms
Recall@1: 0.833
Recall@3: 1.000
Recall@5: 1.000
```

这说明六个固定问题中，五个问题的正确章节排在第一；全部正确章节都进入了前三。

## 14. 如何测试

### 14.1 全部自动化测试

```cmd
npm test
```

### 14.2 类型检查

```cmd
npm run typecheck
```

### 14.3 完整构建

```cmd
npm run build
```

### 14.4 Embedding 冒烟测试

```cmd
npm run test:embedding
```

### 14.5 RAG 基准

```cmd
npm run rag:benchmark
```

### 14.6 Electron 手动测试

```cmd
npm run dev:electron
```

建议顺序：

1. 使用默认风格发送两轮消息；
2. 切换到“治愈安心”；
3. 继续讨论刚才的话题；
4. 确认历史仍在，语气发生变化；
5. 再发一条消息，确认风格仍生效；
6. 询问“昔涟最初是什么形态”；
7. 在 Agent Events 中检查 `search_knowledge`；
8. 点击 New Chat，确认消息清空但风格保留；
9. 重启应用，确认风格仍然保留。

## 15. 推荐阅读顺序

为了减少一次阅读太多文件，建议按下面顺序：

```text
1. src/shared/persona-types.ts
2. src/main/prompts/prompt-loader.ts
3. src/main/prompts/prompt-composer.ts
4. src/main/config/persona-config.ts
5. src/main/chat/chat-session.ts
6. src/shared/ipc-channels.ts
7. src/shared/electron-api.ts
8. src/preload/index.ts
9. src/main/app/register-chat-ipc.ts
10. src/renderer/chat/style-selector.ts
11. src/renderer/chat/main.ts
12. src/main/rag/markdown-knowledge-loader.ts
13. src/main/rag/cyrene-knowledge.ts
14. src/main/rag/default-knowledge.ts
15. src/cli/rag-benchmark.ts
```

先理解前五个文件，就能掌握“人格和风格状态”；再理解 IPC 与 Renderer，就能掌握“界面如何安全控制 Main”；最后阅读 RAG 文件，就能掌握“Markdown 如何变成可检索向量”。

## 16. 本阶段有意留下的边界

Phase 6D 没有追求一次复刻所有源项目能力，以下内容将在后续阶段单独学习：

- 多会话与聊天历史持久化；
- 用户记忆系统；
- Skills 注册、启用和按场景注入；
- `cyrene-original-voice` 自动场景匹配；
- 源项目 DMAE 世界书激活机制；
- 用户导入自定义知识文件；
- 语音识别、语音合成和通话。

当前阶段最重要的架构结论是：

```text
人格规则属于每轮稳定控制上下文
世界观属于按需检索知识
风格属于会话状态
聊天历史属于用户与模型真正说过的话
```

把这四种数据分开，后续新增记忆、Skills 或多会话时才不会互相污染。
