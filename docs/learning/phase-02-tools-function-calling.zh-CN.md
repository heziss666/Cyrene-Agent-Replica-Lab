# Phase 2：工具调用与 Agent Loop

这一阶段把 Phase 1 的普通聊天升级成最小工具调用 Agent。

Phase 1 的流程是：

```text
用户输入
-> 调用一次模型
-> 打印模型文本回复
```

Phase 2 的流程变成：

```text
用户输入
-> 把 messages 和 tools 一起发给模型
-> 模型决定是否请求工具
-> 程序执行工具
-> 工具结果回填到 messages
-> 再次调用模型
-> 模型给出最终回复
```

## 最重要的概念

模型不会真的执行工具。

模型只会返回类似这样的请求：

```text
我想调用 calculator，参数是 {"expression":"2+2"}
```

真正执行工具的是我们的 TypeScript 程序。

所以 function calling 的核心不是“模型获得了超能力”，而是：

```text
模型负责决策
程序负责执行
messages 负责记录过程
```

## 新增文件

```text
src/main/tools/tool-types.ts
src/main/tools/tool-registry.ts
src/main/tools/built-in-tools.ts
src/main/agent/tool-agent.ts
```

测试：

```text
tests/tools/tool-registry.test.ts
tests/tools/built-in-tools.test.ts
tests/agent/tool-agent.test.ts
```

## 1. tool-types.ts

这个文件定义工具相关类型：

```text
ToolDefinition
ToolSpec
ToolCall
ToolExecutionResult
```

可以这样理解：

```text
ToolDefinition：程序内部真正可执行的工具
ToolSpec：发给模型看的工具说明书
ToolCall：模型请求调用某个工具
ToolExecutionResult：程序执行工具后的结果
```

## 2. tool-registry.ts

`ToolRegistry` 是工具注册表。

它负责：

```text
注册工具
按 id 查找工具
列出启用的工具
把工具转成模型可见的 ToolSpec
```

Agent loop 不应该到处散落工具列表，而是统一从 registry 拿工具。

## 3. built-in-tools.ts

当前有三个安全工具：

```text
get_current_time
calculator
echo
```

`get_current_time` 返回当前 ISO 时间。

`calculator` 计算简单算术表达式。

`echo` 原样返回输入文本，主要用来测试工具调用流程。

本阶段没有文件读写、shell 命令、网络搜索，因为那些需要权限系统，后面再做。

## 4. openai-compatible.ts 的变化

Phase 1 请求体只有：

```json
{
  "model": "deepseek-chat",
  "messages": [],
  "stream": false
}
```

Phase 2 如果有工具，会额外带上：

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "...",
        "parameters": {}
      }
    }
  ],
  "tool_choice": "auto"
}
```

这表示：

```text
模型可以自己判断要不要调用工具
```

adapter 也负责解析模型返回的：

```text
tool_calls
```

并把工具执行结果回填成：

```text
role: "tool"
toolCallId: ...
name: ...
content: ...
```

## 5. tool-agent.ts

`runToolAgent` 是本阶段核心。

它的循环逻辑是：

```text
最多循环 5 轮
每轮调用模型
如果模型没有请求工具，返回最终文本
如果模型请求工具，执行工具
把工具结果加入 conversation
继续下一轮
```

为什么要限制最大轮数？

因为模型可能一直请求工具。如果没有限制，程序可能进入无限循环。

## 6. chat.ts 的变化

终端入口还是：

```powershell
npm.cmd run dev:chat
```

但内部已经从：

```text
runMinimalAgent
```

切换成：

```text
runToolAgent
```

所以真实运行时，模型会看到三个工具：

```text
get_current_time
calculator
echo
```

你可以测试：

```text
现在几点？
请计算 2 + 3 * (4 - 1)
调用 echo 工具返回 hello
```

模型是否调用工具取决于模型自己的判断。我们只是把工具说明书发给它。

## 和源项目的对应关系

源项目相关位置：

```text
src/main/orchestrator/function-calling.ts
src/main/orchestrator/tool-registry.ts
src/main/orchestrator/built-in-tools.ts
src/main/orchestrator/vendors/openai-adapter.ts
```

学习版保留了源项目的核心思想：

```text
Agent loop 不关心 OpenAI wire 格式
adapter 负责请求和响应格式转换
registry 负责工具管理
模型只请求工具，程序负责执行工具
工具结果必须回填给模型
```

但学习版暂时删掉了复杂部分：

```text
权限系统
MCP
RAG
记忆
UI 事件流
上下文压缩
token 统计
```

## 本阶段你应该掌握

```text
什么是 tools
什么是 tool_calls
什么是 role:"tool"
为什么工具结果要回填 messages
为什么 agent loop 不是一次模型调用
为什么不同模型供应商需要 adapter
```

理解这些后，再看源项目的 `function-calling.ts` 会容易很多。
