# Phase 6D：昔涟人格、可切换风格与世界观知识库设计

## 1. 背景

Phase 6A 到 Phase 6C 已经完成了最小 RAG、Ollama 向量检索和 JSON 持久化向量索引。目前运行时知识库只有三条用于教学的种子文本，无法验证较大中文语料下的切分质量、首次建库速度、热启动速度和真实召回效果。

本阶段从源项目中引入昔涟的角色设定、文字风格和世界观文本，在不加入语音、通话、Live2D 等功能的前提下，完成一个可测试的角色 Agent 文本版本。

本阶段采用“人格常驻 System Prompt，世界观按需 RAG，风格动态切换”的混合架构。

## 2. 目标

本阶段必须实现以下目标：

1. 导入源项目中与文字人格直接相关的 Prompt 文件。
2. 让昔涟的身份、性格和基础语气稳定存在于每轮模型请求中。
3. 将大体量世界观和原作台词作为 RAG 语料，而不是全部塞入 System Prompt。
4. 支持五种文字回复风格，并允许用户在当前会话中切换。
5. 切换风格时保留已有对话历史，不自动创建新会话。
6. 风格切换后的第一轮向模型发送一次临时内部提醒。
7. 将世界观 Markdown 按语义章节解析成知识文档，再复用现有切块、Embedding 和持久化索引。
8. 增加可重复运行的性能与召回基准测试。
9. CLI 与 Electron 共用同一套 Prompt、风格和知识库逻辑。
10. 保持代码结构适合初学者逐模块阅读。

## 3. 非目标

本阶段明确不实现：

- ASR 语音识别；
- TTS 语音合成；
- 麦克风、音频播放和通话窗口；
- `phone_system.md`、`phone_identity.md`、`phone_style.md`；
- `talk_system.md` 及“纯聊天模式”；
- Live2D 模型和动作；
- 完整的 Skills 调度系统；
- `cyrene-original-voice` 的场景自动识别和动态注入；
- 源项目的 DMAE 世界书激活算法；
- 多会话持久化和应用重启后的聊天历史恢复；
- 将源项目所有 README、开发文档或无关 Skills 导入知识库。

`cyrene-original-voice` 可以作为未启用的学习素材复制进项目，但本阶段运行时不得加载它。

## 4. 方案选择

### 4.1 方案 A：所有文本全部放入 System Prompt

优点是实现简单，模型每轮都能看到全部设定。缺点是每次请求都携带大量重复文本，增加 Token 消耗、响应延迟和 lost-in-the-middle 风险，而且无法验证现有 RAG。

本阶段不采用。

### 4.2 方案 B：所有文本全部放入 RAG

优点是 System Prompt 很短。缺点是身份和说话方式也依赖检索，角色一致性不稳定；一次检索失败就可能让模型失去人格约束。

本阶段不采用。

### 4.3 方案 C：人格常驻、世界观 RAG、风格动态切换

这是本阶段采用的方案：

- 身份、性格、基础语气和当前风格进入 System Prompt；
- 世界观和原作台词进入向量知识库；
- 当前风格由会话状态维护；
- 风格变化不删除已有消息；
- 与源项目能力不匹配的 System 规则不进入运行时 Prompt。

## 5. 素材范围与目录

### 5.1 导入的人格素材

以下源文件需要保留：

```text
prompts/system.md
prompts/identity.md
prompts/soul.md
prompts/tone-rules.md
```

其中 `identity.md`、`soul.md` 和 `tone-rules.md` 可以直接参与运行时 Prompt 拼装。

源 `system.md` 包含本地文件、生活工具、文档生成等尚未全部复刻的能力声明，因此只作为原始参考保留。运行时使用一份适配当前项目能力的基础规则文件，例如：

```text
resources/cyrene/prompts/runtime-system.md
```

该文件应说明当前 Agent 的真实身份、回复原则、工具调用边界和未知信息处理方式，不得声称拥有未注册的工具。

### 5.2 导入的风格素材

```text
prompts/styles/01_default.md
prompts/styles/02_lively.md
prompts/styles/03_healing.md
prompts/styles/04_focused.md
prompts/styles/05_sweet.md
```

运行时使用稳定的 Style ID，不把文件名直接暴露给业务层：

```ts
export type StyleId =
  | "default"
  | "lively"
  | "healing"
  | "focused"
  | "sweet";
```

### 5.3 导入的 RAG 素材

```text
prompts/canon_quotes.md
prompts/worldbook/_glossary.md
prompts/worldbook/Cyrene.md
prompts/worldbook/characters.md
prompts/worldbook/story.md
prompts/worldbook/world.md
```

### 5.4 排除的素材

以下内容不复制或不参与运行时：

- 项目 README 和开发说明；
- `phone_*.md`；
- `talk_system.md`；
- 音频、通话、模型资源；
- 与本阶段无关的 Skills；
- `.bak` 备份文件。

### 5.5 来源与免责声明

项目需要保留素材来源说明和上游许可证副本。昔涟及相关世界观属于《崩坏：星穹铁道》相关角色 IP，本项目应明确标注为学习用途和同人衍生项目，不得暗示拥有底层角色 IP，也不应将这部分素材作为商业授权资产。

## 6. Prompt 架构

### 6.1 Prompt 拼装顺序

每轮请求的 System Prompt 按以下顺序构造：

```text
运行时基础规则
---
identity.md
---
soul.md
---
tone-rules.md
---
当前风格文件
---
本轮临时内部指令（可选）
```

顺序原则：

- 能力边界最先出现；
- 稳定人格位于中间；
- 当前风格靠后，以便覆盖历史消息中的旧风格惯性；
- 本轮临时指令最后出现，且只影响当前请求。

### 6.2 Prompt 加载器

新增 `prompt-loader.ts`，职责仅包括：

- 根据稳定资源目录读取 UTF-8 文本；
- 去掉首尾空白；
- 对不存在、不可读或空文件给出明确错误；
- 不负责决定 Prompt 拼装顺序；
- 不依赖 Electron Renderer。

新增 `prompt-composer.ts`，职责包括：

- 根据 `StyleId` 选择风格文件；
- 组合基础规则、人格和风格；
- 接收可选的临时风格切换提醒；
- 返回最终 System Prompt 字符串；
- 允许测试注入内存文件内容，避免单元测试依赖真实文件系统。

### 6.3 System 消息与历史消息分离

当前 `ChatSession` 将初始 System 消息和聊天历史放在同一个数组中。为了支持动态风格，本阶段改为：

```ts
interface ChatSessionState {
  activeStyle: StyleId;
  messages: ChatMessage[];
  pendingStyleTransition?: StyleTransition;
}
```

`messages` 只保存用户、助手和工具消息。每次调用模型前才构造：

```ts
const requestMessages = [
  { role: "system", content: composeSystemPrompt(sessionState) },
  ...sessionState.messages,
];
```

这可以避免旧 System Prompt 永久留在历史中，也避免切换风格后同时存在多个互相冲突的 System 消息。

Agent Loop 返回完整请求消息时，IPC 会先移除首条动态 System 消息，再写回 `ChatSession`。该 System 消息属于请求上下文，不能被当作普通历史再次持久化。

## 7. 风格切换设计

### 7.1 会话状态

```ts
export interface StyleTransition {
  from: StyleId;
  to: StyleId;
}

export interface ChatSessionState {
  activeStyle: StyleId;
  messages: ChatMessage[];
  pendingStyleTransition?: StyleTransition;
}
```

### 7.2 切换流程

用户从 `default` 切换到 `healing` 时：

1. 保留 `messages`；
2. 将 `activeStyle` 改为 `healing`；
3. 保存 `{ from: "default", to: "healing" }`；
4. 不创建新会话；
5. 不立即请求模型。

下一次用户发送消息时，Prompt Composer 在 System Prompt 尾部临时加入：

```text
【本轮内部风格切换提醒】
回复风格已从“温柔和善”切换为“治愈安心”。
继续理解并使用此前对话内容，但从本轮开始遵守新的回复风格。
不要声称丢失了记忆，不要重新进行自我介绍。
```

模型成功返回后清除 `pendingStyleTransition`。

如果模型请求失败，则保留该提醒，以便下一次重试仍能得到正确风格。

### 7.3 为什么提醒不写入历史

这条提醒属于应用状态，不是用户说过的话。如果永久写入历史，会出现以下问题：

- 多次切换产生大量过期提醒；
- 模型可能同时看到互相冲突的风格指令；
- 用户导出聊天记录时混入内部实现信息；
- 不同供应商对历史中间的 System 消息支持不一致。

因此提醒只参与一次请求，并合并到最前面的 System Prompt 中。

### 7.4 风格配置持久化

当前选择的风格保存到用户目录中的独立 JSON 配置。读取失败、字段无效或文件不存在时回退到 `default`。

本阶段只持久化“上次选择的全局风格”，不持久化聊天内容。应用重启后风格可以恢复，但此前对话仍不会恢复，这属于后续会话持久化阶段。

## 8. Electron IPC 与界面

### 8.1 IPC 通道

新增两个 IPC 操作：

```text
cyrene:persona:get-style
cyrene:persona:set-style
```

Renderer 只能通过 Preload 暴露的受限 API 调用：

```ts
window.cyrene.persona.getStyle();
window.cyrene.persona.setStyle(styleId);
```

Main 进程必须验证 `styleId`，不能信任 Renderer 传入的任意字符串。

### 8.2 界面

聊天界面增加一个紧凑的风格选择器：

```text
温柔和善
元气活泼
治愈安心
知性认真
撒娇黏人
```

切换后不清空聊天记录。选择器显示当前状态即可，不要求在聊天记录中插入可见的“风格已切换”消息。

## 9. 世界观 Markdown 解析

### 9.1 解析单位

世界书文件中的每个二级标题 `##` 视为一个语义条目。文件开头的一级标题和说明作为文档上下文，不独立建立向量。

例如：

```markdown
## 翁法罗斯之心 / PHILIA093
- 触发词：……

正文……
```

转换为：

```ts
{
  id: "worldbook_cyrene_philia093",
  title: "翁法罗斯之心 / PHILIA093",
  source: "worldbook/Cyrene.md",
  text: "标题、触发词和正文",
  metadata: {
    collection: "cyrene-worldbook",
    file: "Cyrene.md",
    section: "翁法罗斯之心 / PHILIA093"
  }
}
```

### 9.2 ID 稳定性

文档 ID 必须由相对路径和标题生成，并经过稳定规范化。相同素材重复启动时必须生成相同 ID，否则持久化索引会被无意义重建。

如果同一文件出现重复标题，应附加稳定序号，不能静默覆盖。

### 9.3 特殊文件

- `_glossary.md`：每个二级标题作为独立称谓映射文档；
- `canon_quotes.md`：每段有明确标题时按标题拆分，否则按分隔线拆分；
- 无二级标题的普通 Markdown：整份文件作为一个文档；
- 空章节：忽略并记录警告。

### 9.4 与现有切块器的关系

Markdown Loader 负责产生语义完整的 `KnowledgeDocument[]`，现有 `chunkText()` 继续负责处理超过块大小的长章节。

```text
Markdown 文件
  -> Markdown Loader 按章节拆文档
  -> KnowledgeStore 按长度切块
  -> Ollama Embedding
  -> JSON Vector Index
```

本阶段不修改余弦相似度算法，也不引入新的向量数据库。

## 10. 运行时知识库

正式运行时默认知识库改为：

```text
worldbook 五个文件
+ canon_quotes.md
```

当前三条教学用 `DEFAULT_DOCUMENTS` 保留为测试夹具，不再混入正式世界观检索，避免角色问题返回 ToolRegistry 或 Minimal RAG 文本。

`search_knowledge` 的工具接口继续保持：

```ts
{
  query: string;
  topK?: number;
}
```

本阶段不增加 collection 参数，先保持工具调用协议简单。结果仍返回文档标题、来源、相似度和文本。

## 11. 持久化索引兼容

Phase 6C 已根据文档内容、切块参数、Embedding 提供商和模型判断缓存是否有效。本阶段导入新语料后，语料指纹变化应触发一次自动重建。

后续启动时，只要以下内容不变，就应直接加载已有索引：

- 世界观文件内容；
- Markdown 解析结果；
- 切块大小和重叠；
- Embedding 提供商；
- Embedding 模型；
- 索引 Schema 版本。

日志必须能够区分：

```text
索引缺失
语料变化导致重建
配置变化导致重建
成功加载已有索引
```

## 12. 基准测试

### 12.1 命令

新增：

```bash
npm run rag:benchmark
```

### 12.2 性能指标

至少输出：

- Markdown 文件数量；
- 解析后的文档数量；
- 最终知识块数量；
- Embedding 向量维度；
- 索引文件大小；
- 冷启动建库耗时；
- 热启动索引加载耗时；
- 每个固定问题的查询耗时；
- 平均查询耗时。

### 12.3 召回指标

准备固定中文问题及期望文档 ID，例如：

```text
昔涟最初是什么形态？
迷迷、昔涟和德谬歌是什么关系？
白厄是谁？
翁法罗斯经历了什么？
《如我所书》是什么？
昔涟为什么会被开拓者吸引？
```

计算：

```text
Recall@1
Recall@3
Recall@5
```

基准测试的首要用途是观察变化，不在本阶段设定脱离真实结果的强制百分比门槛。实现完成后记录基线数据，后续优化切块、查询改写或混合检索时再做对比。

## 13. 错误处理

### 13.1 Prompt 文件错误

核心人格文件缺失或为空时应快速失败，并指出具体文件，不能悄悄退回成无人格 Agent。

### 13.2 风格错误

- 配置中的未知 Style ID：回退 `default` 并记录警告；
- Renderer 传入未知 Style ID：IPC 返回明确错误；
- 风格文件缺失：拒绝切换，不修改当前风格。

### 13.3 世界观错误

- 单个 Markdown 文件解析失败：指出文件并停止初始化；
- 没有解析出任何文档：拒绝创建正式知识库；
- Ollama 不可用：继续使用现有关键词回退；
- 向量索引损坏：沿用 Phase 6C 的自动重建机制。

## 14. 测试策略

### 14.1 单元测试

- 五种 Style ID 的验证与文件映射；
- Prompt Composer 的拼装顺序；
- 缺失核心文件时报错；
- Markdown 二级标题解析；
- 重复标题 ID 稳定性；
- 无标题和空章节处理；
- 风格切换保留消息；
- 成功回复后清除临时提醒；
- 请求失败后保留临时提醒；
- 无效配置回退默认风格。

### 14.2 集成测试

- Electron IPC 获取和设置风格；
- Preload 只暴露受限风格 API；
- CLI 与 Electron 生成相同的基础人格 Prompt；
- 新语料首次运行创建向量索引；
- 第二次运行复用索引且文件不被改写；
- 世界观问题能通过 `search_knowledge` 返回预期来源。

### 14.3 手动验收

1. 以默认风格连续对话两轮；
2. 切换到治愈风格；
3. 继续讨论前一轮话题，确认没有失忆；
4. 检查回复语气已经变化；
5. 再次发送消息，确认临时切换提醒没有重复；
6. 询问世界观问题，观察 Agent 事件日志中的检索条目；
7. 重启应用，确认风格保留、向量索引热加载；
8. 确认聊天历史不会被错误宣称为跨重启保留。

## 15. 预计代码边界

新增模块：

```text
src/main/prompts/prompt-loader.ts
src/main/prompts/prompt-composer.ts
src/main/prompts/style-types.ts
src/main/config/persona-config.ts
src/main/rag/markdown-knowledge-loader.ts
src/main/rag/cyrene-knowledge.ts
src/shared/persona-types.ts
scripts/rag-benchmark.ts
resources/cyrene/...
```

预计修改：

```text
src/main/chat/chat-session.ts
src/main/app/register-chat-ipc.ts
src/cli/chat.ts
src/main/rag/default-knowledge.ts
src/shared/ipc-channels.ts
src/shared/electron-api.ts
src/preload/index.ts
src/renderer/chat/*
package.json
```

具体文件数量可以在实施计划中根据现有测试结构微调，但不得突破本设计的功能边界。

## 16. 完成标准

Phase 6D 完成需要同时满足：

1. 五种风格均可从 Electron 界面选择；
2. 切换风格不会清空当前对话；
3. 下一轮请求包含一次临时风格切换提醒；
4. 人格 Prompt 与聊天历史在代码中分离；
5. 世界观文件按语义章节进入知识库；
6. `qwen3-embedding:4b` 能完成真实建库和查询；
7. 冷启动和热启动行为可观察；
8. 固定问题可以输出 Recall@K 基线；
9. CLI、Electron、类型检查、构建和全部自动化测试通过；
10. 没有加入任何语音或通话代码；
11. 有一份面向初学者的中文学习文档解释新增模块与完整数据流。
