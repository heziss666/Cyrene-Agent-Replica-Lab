# Phase 2：Tools + Function Calling 设计说明

这份文档说明学习版 Cyrene-Agent 的第二阶段要做什么。

本阶段目标：把 Phase 1 的“普通聊天 Agent”升级为“能调用工具的终端 Agent”。

## 当前状态

Phase 1 的流程是：

```text
用户输入
-> chat.ts 把输入加入 history
-> runMinimalAgent 调用一次模型
-> openAICompatibleAdapter 构造 /chat/completions 请求
-> 模型返回 assistant 文本
-> chat.ts 打印文本
```

它的特点是：

```text
每次用户输入只调用一次模型
模型只能返回文本
没有 tools
没有 tool_calls
没有工具执行
没有工具结果回填
```

## 本阶段要实现的能力

新流程是：

```text
用户输入
-> chat.ts 把输入加入 history
-> runToolAgent 把 messages + tools 发给模型
-> 模型返回普通文本，或返回 tool_calls
-> 如果有 tool_calls，程序执行对应工具
-> 程序把工具结果作为 role:"tool" 消息加入 conversation
-> 再次调用模型
-> 直到模型不再请求工具
-> 返回最终 assistant 文本
```

这就是最小版 function calling agent loop。

## 本阶段暂不实现

为避免学习负担过大，本阶段不做：

```text
Electron
RAG
记忆系统
MCP
权限弹窗
文件读写工具
shell 命令工具
流式输出
多供应商 Anthropic 适配
工具结果压缩
```

## 文件设计

新增文件：

```text
src/main/tools/tool-types.ts
src/main/tools/tool-registry.ts
src/main/tools/built-in-tools.ts
src/main/agent/tool-agent.ts
docs/learning/phase-02-tools-function-calling.zh-CN.md
```

修改文件：

```text
src/shared/chat-types.ts
src/main/vendors/types.ts
src/main/vendors/openai-compatible.ts
src/cli/chat.ts
```

测试文件：

```text
tests/tools/tool-registry.test.ts
tests/tools/built-in-tools.test.ts
tests/vendors/openai-compatible.test.ts
tests/agent/tool-agent.test.ts
tests/cli/chat.test.ts
```

## 核心类型

`ChatMessage` 会扩展为支持工具消息：

```ts
role: "system" | "user" | "assistant" | "tool"
```

assistant 消息可以带：

```text
toolCalls
```

tool 消息可以带：

```text
toolCallId
name
content
```

工具定义包含：

```text
id
description
parameters
execute(args)
```

vendor adapter 的统一返回结果会从简单文本扩展为：

```text
assistantMessage
text
toolCalls
finishReason
usage
```

## 内置工具

本阶段只做三个安全工具：

```text
get_current_time
calculator
echo
```

`get_current_time` 返回当前 ISO 时间。

`calculator` 计算简单数学表达式，只允许数字、空格、加减乘除、小数点和括号。

`echo` 回显输入文本，主要用于测试和理解工具调用链路。

## 和源项目的关系

源项目对应文件：

```text
src/main/orchestrator/function-calling.ts
src/main/orchestrator/tool-registry.ts
src/main/orchestrator/built-in-tools.ts
src/main/orchestrator/vendors/types.ts
src/main/orchestrator/vendors/openai-adapter.ts
```

学习版保留源项目的核心思路：

```text
Agent loop 不关心具体供应商格式
供应商差异由 adapter 处理
工具统一注册到 ToolRegistry
模型只请求工具，程序负责执行工具
工具结果必须回填给模型
```

学习版暂时简化源项目的复杂部分：

```text
不做权限系统
不做 MCP 工具
不做 RAG 工具
不做上下文压缩
不做 token usage 记录
不做 AG-UI 事件桥
```

这些会在后续阶段逐步补上。

## 错误处理

本阶段的错误处理规则：

```text
模型 HTTP 请求失败：抛出 Model request failed: HTTP ...
模型请求不存在的工具：把错误作为 tool 结果回填给模型
工具参数 JSON 解析失败：把错误作为 tool 结果回填给模型
工具执行抛错：把错误作为 tool 结果回填给模型
超过最大工具轮数：抛出 Tool agent exceeded max rounds
```

最大工具轮数先设为：

```text
5
```

这个限制用于防止模型一直请求工具，导致无限循环。

## 测试策略

本阶段继续使用 Vitest。

重点测试：

```text
ToolRegistry 能注册、读取、执行工具
内置工具行为正确
OpenAI-compatible adapter 能发送 tools
OpenAI-compatible adapter 能解析 tool_calls
OpenAI-compatible adapter 能把 tool result 变成 role:"tool" 消息
runToolAgent 能执行一轮工具调用再得到最终回答
chat.ts 默认改用 runToolAgent
```

## 学习目标

完成后你应该能理解：

```text
什么是 tool schema
什么是 tool_calls
为什么模型不会真的执行工具
为什么工具结果要回填 messages
为什么 Agent loop 要限制最大轮数
为什么 adapter 层要负责不同供应商的工具格式
```
