# Phase 1：最小可运行 Agent

> 当前状态（2026-07-16）：本章记录的是 Phase 1 的历史学习实现。项目现已使用
> `src/main/agent/tool-agent.ts` 作为唯一 Agent Loop；早期的
> `src/main/agent/minimal-agent.ts` 及其专属测试已删除。下文中的旧文件路径和
> `runMinimalAgent()` 代码用于理解演进过程，不代表当前运行结构。

这一阶段只做一件事：让一个 TypeScript 终端程序能够把用户输入发给 DeepSeek / OpenAI-compatible 聊天接口，并打印模型回复。

它是后面所有复杂能力的地基。

```text
用户输入
-> 变成 ChatMessage[]
-> 读取模型配置
-> 构造 HTTP 请求
-> 调用模型 API
-> 解析 assistant 回复
-> 打印到终端
```

本阶段还没有实现这些能力：

```text
Electron 桌面窗口
工具调用
RAG
记忆系统
skills
Live2D
语音
调度器
MCP
```

先把最小链路跑通，是为了让你看清楚 Agent 最核心的骨架。后面加工具、RAG、记忆，本质上都是在这条链路上增加上下文或行动能力。

## 当前文件结构

```text
src/shared/chat-types.ts
src/main/config/model-config.ts
src/main/vendors/types.ts
src/main/vendors/openai-compatible.ts
src/main/agent/minimal-agent.ts
src/cli/chat.ts
```

对应测试：

```text
tests/agent/minimal-agent.test.ts
tests/cli/chat.test.ts
tests/config/model-config.test.ts
tests/vendors/openai-compatible.test.ts
```

## 1. shared：聊天消息格式

文件：

```text
src/shared/chat-types.ts
```

这里定义了最基础的聊天消息：

```ts
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}
```

你可以把 `ChatMessage` 理解成“给大模型看的对话记录中的一行”。

常见角色：

```text
system：系统提示词，用来规定 Agent 的身份、风格、规则
user：用户说的话
assistant：模型，也就是 Agent，之前回复过的话
```

例如：

```ts
[
  { role: "system", content: "You are a helpful agent." },
  { role: "user", content: "你好" },
  { role: "assistant", content: "你好，我可以帮你什么？" }
]
```

后面做记忆系统、RAG、工具调用时，也会继续围绕这组 messages 工作。

## 2. config：模型配置

文件：

```text
src/main/config/model-config.ts
```

这个文件负责从环境变量读取模型配置：

```text
CYRENE_MODEL_PROVIDER
CYRENE_MODEL_BASE_URL
CYRENE_MODEL_NAME
CYRENE_MODEL_API_KEY
```

当前默认值：

```text
provider: deepseek
baseUrl: https://api.deepseek.com
model: deepseek-chat
```

但是 API key 没有默认值，因为它是秘密，不能写进代码。

如果你没有设置：

```text
CYRENE_MODEL_API_KEY
```

程序会直接报错：

```text
CYRENE_MODEL_API_KEY is required
```

这是一种很重要的工程习惯：秘密信息放在环境变量或本地 `.env`，不要提交进 Git。

## 3. vendors：模型供应商适配器

文件：

```text
src/main/vendors/types.ts
src/main/vendors/openai-compatible.ts
```

`types.ts` 定义统一接口：

```ts
export interface VendorAdapter {
  readonly id: string;
  buildRequest(input: ChatCompletionInput, config: ModelConfig): VendorHttpRequest;
  parseResponse(data: unknown): ChatCompletionResult;
}
```

它表达的是：

```text
给我 messages 和模型配置
我帮你构造 HTTP 请求

给我模型返回的 JSON
我帮你解析出 assistant 文本
```

为什么要单独做 adapter？

因为 DeepSeek、OpenAI、月之暗面、通义千问等服务可能都提供类似 OpenAI 的接口，但细节可能不同。把这层单独拆出来，后面换模型供应商时就不用改 Agent 主逻辑。

当前的 `openAICompatibleAdapter` 会构造这样的请求：

```text
POST https://api.deepseek.com/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json
```

请求体大致是：

```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "user", "content": "hello" }
  ],
  "stream": false
}
```

它也会从返回值中解析：

```text
choices[0].message.content
```

这就是 assistant 的回复文本。

## 4. minimal-agent：最小 Agent 函数

文件：

```text
src/main/agent/minimal-agent.ts
```

核心函数：

```ts
runMinimalAgent(input): Promise<string>
```

它做的事情非常少：

```text
1. 让 adapter 构造请求
2. 用 fetch 发 HTTP 请求
3. 如果 HTTP 失败，抛出清楚错误
4. 如果成功，解析 JSON
5. 返回 assistant 文本
```

注意：它不负责读取环境变量，也不直接写 DeepSeek 的 URL。

这是刻意设计的职责分离：

```text
model-config.ts：负责配置
openai-compatible.ts：负责请求格式和响应格式
minimal-agent.ts：负责执行一次模型调用
chat.ts：负责终端交互
```

这样每个文件都很小，初学时更容易跟踪。

## 5. cli：终端聊天入口

文件：

```text
src/cli/chat.ts
```

这个文件提供命令：

```powershell
npm.cmd run dev:chat
```

启动后会显示：

```text
Cyrene Agent Replica Lab - terminal chat
Type /exit to quit.

You>
```

输入普通文本，它会调用模型；输入 `/exit`，它会退出。

当前 CLI 会维护一个简单的 `history`：

```text
system message
user message
assistant message
user message
assistant message
...
```

这就是最简单的“上下文记忆”。不过它只存在内存里，程序退出后就没了。后面实现真正记忆系统时，会把重要信息写入文件、数据库或向量库。

## 6. Windows 上为什么用 npm.cmd

在你的机器上，PowerShell 目前禁止运行 `.ps1` 脚本，所以直接运行：

```powershell
npm install
```

可能会触发：

```text
npm.ps1 cannot be loaded because running scripts is disabled on this system
```

这不是 Node.js 安装坏了，而是 PowerShell 执行策略拦截了 `npm.ps1`。

简单做法是使用：

```powershell
npm.cmd install
npm.cmd test
npm.cmd run typecheck
npm.cmd run dev:chat
```

`npm.cmd` 和 `npm` 指向的是同一套 npm，只是走 Windows 批处理入口，不会被 `.ps1` 策略拦住。

## 7. 如何运行

进入项目：

```powershell
cd /d C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab
```

安装依赖：

```powershell
npm.cmd install
```

运行测试：

```powershell
npm.cmd test
```

运行类型检查：

```powershell
npm.cmd run typecheck
```

推荐方式：在项目根目录新建 `.env` 文件。

文件路径：

```text
C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\.env
```

内容写成：

```text
CYRENE_MODEL_PROVIDER=deepseek
CYRENE_MODEL_BASE_URL=https://api.deepseek.com
CYRENE_MODEL_NAME=deepseek-chat
CYRENE_MODEL_API_KEY=你的真实 DeepSeek API key
```

然后直接启动：

```powershell
npm.cmd run dev:chat
```

`.env` 已经被 `.gitignore` 忽略，不应该提交到代码仓库。

临时方式：也可以只在当前 PowerShell 窗口设置环境变量：

```powershell
$env:CYRENE_MODEL_PROVIDER="deepseek"
$env:CYRENE_MODEL_BASE_URL="https://api.deepseek.com"
$env:CYRENE_MODEL_NAME="deepseek-chat"
$env:CYRENE_MODEL_API_KEY="你的真实 API key"
```

启动终端聊天：

```powershell
npm.cmd run dev:chat
```

退出：

```text
/exit
```

## 8. 和源项目的关系

源项目中，类似能力散落在更复杂的位置，例如：

```text
src/main/orchestrator/vendors
src/main/orchestrator/function-calling.ts
src/main/index.ts
```

源项目还同时处理 Electron、Live2D、语音、工具、skills、记忆、RAG 等能力，所以入口会复杂很多。

学习版先把它拆成更小的链路：

```text
ChatMessage
-> ModelConfig
-> VendorAdapter
-> runMinimalAgent
-> terminal CLI
```

你可以先完全理解这条链，再继续加复杂能力。

## 9. 下一阶段会加什么

下一阶段建议进入“工具调用”：

```text
ToolDefinition
ToolRegistry
function calling
工具执行
工具结果回填 messages
多轮 agent loop
```

到那时，Agent 不只是“回答”，还可以“决定调用工具并执行动作”。

这会更接近源项目中的 agent loop，也更接近 Claude Code 一类 Agent 的核心机制。
