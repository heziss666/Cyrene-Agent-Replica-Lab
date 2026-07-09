# Cyrene-Agent 复刻项目整体路线图

这份文档是给你看的中文总计划。

它回答三个问题：

```text
1. 我们最终要复刻什么？
2. 为什么要按这个顺序实现？
3. 每个阶段完成后，你应该学会什么、得到什么？
```

## 一句话目标

我们要从零开始做一个学习版 Cyrene-Agent：

```text
先实现最小 Agent
再逐步加入工具、Electron UI、RAG、记忆、Skills、MCP、定时任务、语音、Live2D、外部渠道
最终尽量复刻源项目的完整能力
```

但这个项目不是盲目复制源代码。

我们的目标是：

```text
功能尽量接近源项目
结构比源项目更适合学习
每一步都能运行
每个模块都能解释
复杂模块拆成更小的块实现
```

## 项目位置

源项目：

```text
C:\Study\daydayup\projects\Cyrene-Agent
```

学习复刻项目：

```text
C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab
```

源项目是参考答案，学习项目是我们一步步写出来的版本。

## 总体技术栈

复刻项目使用：

```text
TypeScript
Node.js 22 LTS
Electron
Vite
Vitest
DeepSeek / OpenAI-compatible API
本地 JSON 存储
后续加入 embedding、RAG、Live2D、TTS、MCP 等
```

虽然你目前更熟悉 Python，但我们会直接使用 TypeScript，因为源项目就是 TypeScript + Electron。

讲解时我会用 Python 做类比，代码实现仍然保持 TypeScript。

## 为什么不能一口气完整复刻

源项目的规模很大：

```text
src/main       187 个文件
src/renderer   122 个文件
src/preload      1 个文件
src/shared       7 个文件
```

其中 `src/main` 又包含：

```text
orchestrator
rag
memory
skills
scheduler
channels
tts
asr
call
opener
game-bot
relationship
```

如果直接照搬，你会得到一个“能跑但看不懂”的项目。

所以我们采用：

```text
最小闭环
↓
逐步加能力
↓
每一步对照源项目
↓
每一步都能运行和测试
↓
最后补齐完整功能
```

## 总体阶段

整体分成 14 个阶段。

```text
Phase 0   项目骨架和环境
Phase 1   最小 Agent Loop
Phase 2   Vendor Adapter 模型厂商适配
Phase 3   Tool Registry + Function Calling
Phase 4   Electron main / preload / renderer
Phase 5   聊天 UI 和事件流
Phase 6   RAG
Phase 7   记忆系统
Phase 8   Skills
Phase 9   MCP
Phase 10  Scheduler 定时任务
Phase 11  Voice 语音
Phase 12  Live2D 和主动开口
Phase 13  Channels 外部聊天渠道
Phase 14  总体对齐、优化、重构、补文档
```

后面每个 Phase 都会有单独的执行计划。

比如当前已有：

```text
docs/superpowers/plans/2026-07-08-phase-0-1-minimal-agent.md
```

它只负责 Phase 0 + Phase 1，不是整个项目的完整计划。

## Phase 0：项目骨架和环境

目标：

```text
创建新项目目录
配置 package.json
配置 TypeScript
配置 Vitest
配置基础目录结构
准备本地 .env
```

完成后项目能做：

```text
npm install
npm test
npm run typecheck
```

主要文件：

```text
package.json
tsconfig.json
vitest.config.ts
.gitignore
.env
README.md
```

学习重点：

```text
npm 项目是什么
TypeScript 怎么编译
Vitest 怎么测试
为什么 API Key 不能写进代码
```

对应源项目：

```text
package.json
tsconfig.main.json
tsconfig.preload.json
vite.config.ts
vitest.config.ts
```

## Phase 1：最小 Agent Loop

目标：

```text
在终端里输入一句话
调用 DeepSeek / OpenAI-compatible API
拿到模型回复
打印到终端
```

这一阶段还不做：

```text
Electron
工具调用
RAG
记忆
Skills
TTS
Live2D
```

最小流程：

```text
用户输入
↓
ChatMessage[]
↓
model config
↓
vendor adapter
↓
fetch HTTP 请求
↓
解析模型回复
↓
打印 assistant 回复
```

主要文件：

```text
src/shared/chat-types.ts
src/main/config/model-config.ts
src/main/vendors/types.ts
src/main/vendors/openai-compatible.ts
src/main/agent/minimal-agent.ts
src/cli/chat.ts
```

学习重点：

```text
什么是 messages
system / user / assistant 三种角色
baseUrl / model / apiKey 是什么
DeepSeek 为什么可以走 OpenAI-compatible 格式
最简单的 Agent loop 是什么
```

对应源项目：

```text
src/main/orchestrator/vendors
src/main/orchestrator/function-calling.ts
src/main/index.ts
```

阶段验收：

```text
能运行 npm run dev:chat
输入中文问题后能拿到模型回复
所有测试通过
```

## Phase 2：Vendor Adapter 模型厂商适配

Phase 1 只会实现一个最小 OpenAI-compatible adapter。

Phase 2 会把它扩展成更接近源项目的结构。

目标：

```text
定义统一 VendorAdapter 接口
支持 OpenAI-compatible
为后续 Anthropic-compatible / MiniMax 等格式预留空间
隔离不同厂商的请求格式和响应格式
```

核心接口：

```text
buildRequest()
parseResponse()
appendToolResults()
```

学习重点：

```text
为什么不要把厂商细节写死在 Agent loop 里
为什么工具结果回填也和厂商格式有关
什么是 transport
什么是 adapter
```

对应源项目：

```text
src/main/orchestrator/vendors/types.ts
src/main/orchestrator/vendors/openai-adapter.ts
src/main/orchestrator/vendors/anthropic-adapter.ts
src/main/orchestrator/vendors/transport-detector.ts
src/main/orchestrator/vendors/capabilities.ts
```

可能优化点：

```text
源项目同时要兼容多家厂商，因此 vendors 复杂度较高
学习版先从 OpenAI-compatible 开始，再逐步抽象
```

## Phase 3：Tool Registry + Function Calling

这是 Agent 从“聊天机器人”变成“能行动的 Agent”的关键阶段。

目标：

```text
注册工具
把工具 schema 发给模型
模型决定是否调用工具
程序执行工具
把工具结果回填给模型
模型继续回复
```

最小工具：

```text
get_current_time
calculator
read_text_file
```

核心流程：

```text
用户输入
↓
LLM 调用
↓
模型返回 tool_calls
↓
执行工具
↓
工具结果加入 conversation
↓
再次调用 LLM
↓
最终回复
```

主要文件：

```text
src/main/tools/tool-types.ts
src/main/tools/tool-registry.ts
src/main/tools/built-in-tools.ts
src/main/agent/function-calling-loop.ts
```

学习重点：

```text
什么是 function calling
模型不是直接执行工具，而是请求程序执行
为什么需要工具 schema
为什么需要最大轮数
为什么工具结果要截断
```

对应源项目：

```text
src/main/orchestrator/function-calling.ts
src/main/orchestrator/tool-registry.ts
src/main/orchestrator/built-in-tools.ts
src/main/orchestrator/fs-tools.ts
src/main/permission.ts
```

可能优化点：

```text
源项目 function-calling.ts 和 cyrene-agent.ts 有重复逻辑
学习版会先做一个单一核心 loop
后面再包装成 UI 事件流
```

## Phase 4：Electron 三层架构

这一阶段把终端 Agent 变成桌面应用。

目标：

```text
Electron main 创建窗口
renderer 显示聊天界面
preload 暴露安全 API
renderer 通过 IPC 调用 main
main 调用 Agent
结果返回 renderer
```

主要文件：

```text
src/main/app/create-window.ts
src/main/app/main.ts
src/preload/index.ts
src/renderer/chat/index.html
src/renderer/chat/main.ts
src/shared/ipc-channels.ts
```

学习重点：

```text
Electron 是什么
Chromium 和 renderer 的关系
Node.js 和 main 的关系
preload 为什么存在
IPC 是什么
```

对应源项目：

```text
src/main/index.ts
src/preload/index.ts
src/renderer/chat
src/shared/ipc-channels.ts
```

可能优化点：

```text
源项目 main/index.ts 太大
学习版会把窗口、IPC、设置、Agent 调用拆开
```

## Phase 5：聊天 UI 和事件流

目标：

```text
显示用户消息和 AI 消息
展示 Agent 执行步骤
展示工具调用过程
模拟流式输出
后续接入真正流式输出
```

事件类型：

```text
run_started
step_started
tool_call_started
tool_call_result
text_delta
run_finished
```

学习重点：

```text
为什么 UI 不应该只等最终字符串
为什么 Agent 过程要变成事件
AG-UI 在源项目里扮演什么角色
```

对应源项目：

```text
src/main/orchestrator/cyrene-agent.ts
src/main/agui-bridge.ts
src/renderer/chat
```

可能优化点：

```text
源项目当前 function calling 本身是 stream:false
UI 的流式感来自把完整文本切成 delta
学习版会先复现这个行为，再讨论是否接真实 streaming
```

## Phase 6：RAG

RAG 是让 Agent 能查本地资料和导入文档的系统。

目标拆分：

```text
定义 MemoryEntry
实现 JSON vector store
实现 cosine similarity
接 embedding provider
实现 addMemory
实现 searchMemory
实现 BM25
实现 hybrid retriever
实现文档 chunk
实现 imported_doc
把检索结果注入 prompt
```

主要文件：

```text
src/main/rag/embedding.ts
src/main/rag/vector-store.ts
src/main/rag/retriever.ts
src/main/rag/chunk.ts
src/main/rag/index.ts
```

学习重点：

```text
embedding 是什么
向量相似度是什么
BM25 和 embedding 有什么区别
为什么要混合检索
为什么文档要切块
```

对应源项目：

```text
src/main/rag/embedding.ts
src/main/rag/vectorstore.ts
src/main/rag/retriever.ts
src/main/rag/chunk.ts
src/main/rag/file-ingest.ts
```

可能优化点：

```text
源项目 JSON vector store 已经做了 IVF 索引
学习版先做线性搜索，理解后再加索引优化
```

## Phase 7：记忆系统

记忆系统是源项目最重要、也最复杂的模块之一。

目标拆分：

```text
定义 L0/L1/L2
实现 memory.json 存储
实现 L0 用户画像
实现 L1 近期状态
实现 L2 事件记忆
实现 MemoryJudge
实现 MemoryManager
L2 同步到 RAG
保存 evidence 证据链
检测冲突候选
实现 resolver
实现 reflection
实现 compressor
实现记忆面板
```

主要文件：

```text
src/main/memory/memory-types.ts
src/main/memory/memory-store.ts
src/main/memory/memory-judge.ts
src/main/memory/memory-manager.ts
src/main/memory/memory-scheduler.ts
src/main/memory/memory-conflict.ts
src/main/memory/memory-resolver.ts
src/main/memory/memory-compressor.ts
```

学习重点：

```text
什么信息应该记
什么信息不应该记
L0/L1/L2 怎么区分
为什么需要 evidence
为什么记忆会冲突
为什么不能粗暴覆盖旧记忆
```

对应源项目：

```text
src/main/memory
src/main/orchestrator/index.ts
src/main/rag/index.ts
```

可能优化点：

```text
源项目 memory 模块功能很完整，但理解成本高
学习版会把写入、检索、冲突、压缩分得更清楚
memory-compressor 的 RAG 同步路径需要重点核查
```

## Phase 8：Skills

Skills 是 Agent 的任务说明书系统。

目标拆分：

```text
扫描 skills 目录
解析 SKILL.md frontmatter
建立 SkillRegistry
启用/禁用 skill
生成 skill catalog
注入 system prompt
实现 invoke_skill
实现 read_skill_reference
实现 slash command
```

主要文件：

```text
src/main/skills/types.ts
src/main/skills/skill-scanner.ts
src/main/skills/skill-registry.ts
src/main/skills/skill-catalog.ts
src/main/skills/skill-tools.ts
```

学习重点：

```text
skill 不是工具
skill 是说明书
tool 是真正执行动作的函数
为什么要按需读取 SKILL.md
为什么 references 不一次性全部注入
```

对应源项目：

```text
skills/
src/main/skills
```

可能优化点：

```text
cyrene-original-voice 放在 skills 目录
但实际由 tone-injector 自动注入
学习版会明确区分普通 skill 和自动注入语气包
```

## Phase 9：MCP

MCP 用来接入外部工具服务器。

目标：

```text
管理 MCP server 配置
启动/关闭 MCP server
读取 MCP tools
把 MCP tools 注册进 ToolRegistry
执行 MCP tool
处理失败和权限
```

学习重点：

```text
MCP 和内置工具有什么区别
为什么 Agent 需要外部工具协议
MCP tool 如何进入 function calling loop
```

对应源项目：

```text
src/main/orchestrator/mcp-manager.ts
src/main/orchestrator/mcp-adapter.ts
src/main/sync-mcp-builtin.ts
```

## Phase 10：Scheduler 定时任务

目标：

```text
创建定时任务
保存任务
计算下次执行时间
执行任务
记录历史
限制可用工具
提供 UI 管理
```

学习重点：

```text
Agent 如何在未来某个时间主动运行
为什么定时任务需要工具过滤
为什么需要执行历史
```

对应源项目：

```text
src/main/scheduler
src/renderer/tasks
```

## Phase 11：Voice 语音

目标：

```text
TTS dispatcher
TTS engine
音频缓存
ASR engine
通话窗口
语音输入输出
```

学习重点：

```text
TTS 和 ASR 分别是什么
为什么需要 dispatcher
为什么音频要缓存
文本回复如何变成声音
```

对应源项目：

```text
src/main/tts
src/main/asr
src/main/call
src/renderer/call
```

## Phase 12：Live2D 和主动开口

目标：

```text
加载 Live2D 模型
播放 motion
切换 expression
实现 play_live2d_action 工具
实现主动气泡 opener
根据场景选择语气和动作
```

学习重点：

```text
Live2D 如何嵌入 Electron
Agent 回复如何驱动动作
工具调用如何控制 UI
主动开口和普通聊天有什么区别
```

对应源项目：

```text
src/renderer/live2d
src/main/orchestrator/tools/play-live2d-action.ts
src/main/opener
src/main/scene-embedder.ts
```

## Phase 13：Channels 外部聊天渠道

目标：

```text
外部消息进入 Agent
统一 dispatcher
不同渠道 adapter
渠道能力限制
消息历史
飞书接入
微信接入
```

学习重点：

```text
为什么同一个 Agent 可以服务多个入口
桌面聊天和外部渠道聊天有什么差异
不同渠道为什么要做能力过滤
```

对应源项目：

```text
src/main/channels
```

## Phase 14：总体对齐、优化和补文档

目标：

```text
对照源项目检查缺失模块
整理设计差异
补充测试
补充中文学习文档
优化模块边界
清理重复逻辑
总结完整 Agent 技术栈
```

这一阶段会重点检查：

```text
学习版哪些地方比源项目简化
哪些简化需要补回
哪些优化应该保留
哪些源项目设计值得学习
哪些源项目结构可以改进
```

## 后续计划文件如何组织

这份文档是总路线图。

每个阶段会有单独的执行计划。

计划文件放在：

```text
docs/superpowers/plans/
```

学习讲义放在：

```text
docs/learning/
```

当前已有执行计划：

```text
docs/superpowers/plans/2026-07-08-phase-0-1-minimal-agent.md
```

后续会继续生成：

```text
docs/superpowers/plans/phase-2-vendor-adapters.md
docs/superpowers/plans/phase-3-tools-function-calling.md
docs/superpowers/plans/phase-4-electron-shell.md
docs/superpowers/plans/phase-5-chat-ui-events.md
docs/superpowers/plans/phase-6-rag.md
docs/superpowers/plans/phase-7-memory.md
...
```

具体文件名可能会带日期。

## 为什么第一份执行计划只写 Phase 0 + Phase 1

因为后面的模块依赖前面的结果。

例如：

```text
没有最小 Agent，就无法加工具调用
没有工具调用，就很难理解 skills 和 MCP
没有基础 Agent 和 UI，就没必要先做 Live2D
没有 RAG，就无法实现完整 L2 记忆召回
```

所以完整计划不是一份超长文件，而是：

```text
一份总路线图
多份阶段执行计划
每个阶段都可运行、可测试、可学习
```

## 每个阶段的固定学习节奏

每个阶段都会按这个节奏走：

```text
1. 先解释这个阶段解决什么问题
2. 对照源项目相关文件
3. 写最小版本
4. 跑测试
5. 手动运行
6. 写中文学习文档
7. 和源项目对比
8. 讨论是否需要优化源项目设计
9. 决定是否进入下一阶段
```

## 当前下一步

当前下一步是执行：

```text
Phase 0 + Phase 1
```

对应计划：

```text
docs/superpowers/plans/2026-07-08-phase-0-1-minimal-agent.md
```

完成后你会得到：

```text
一个可以 npm install 的 TypeScript 项目
一个可以 npm test 的测试环境
一个可以 npm run dev:chat 的终端聊天 Agent
一个 OpenAI-compatible adapter
一份中文 Phase 1 学习讲义
```

这就是整个复刻项目的第一块地基。
