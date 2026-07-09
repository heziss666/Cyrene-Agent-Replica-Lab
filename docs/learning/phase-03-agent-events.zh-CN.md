# Phase 03：Agent 事件流与运行轨迹

这一阶段的目标，是把 Agent 运行过程从“随手 `console.log`”升级成“结构化事件流”。

你可以先把它理解成：

> Agent 每做一件重要的事，就发出一条标准格式的事件。  
> 终端、测试、未来的 Electron 界面、日志系统，都只需要监听这些事件。

---

## 1. 为什么不能只用 console.log？

最开始学习时，直接在终端打印：

```ts
console.log("[tool] call calculator");
```

当然能用。

但随着 Agent 变复杂，会出现几个问题：

1. 终端能看，人不好解析，程序更不好解析。
2. Electron UI 不能稳定依赖一串临时文本。
3. 测试很难判断“第 1 轮模型调用之后是否真的调用了工具”。
4. 以后做记忆、RAG、调试面板时，需要知道完整运行轨迹。

所以我们把“打印文本”前移一步，变成“先产生事件，再决定怎么展示”。

也就是：

```text
Agent 内部行为
  -> AgentEvent 结构化事件
    -> 终端 formatter
    -> Electron UI
    -> Trace 日志
    -> 测试断言
```

---

## 2. 新增文件：agent-events.ts

核心文件：

```text
src/main/agent/agent-events.ts
```

它负责三件事：

1. 定义 `AgentEvent` 类型。
2. 提供 `formatAgentEventForTerminal(...)`，把事件变成终端可读文本。
3. 提供 `createAgentTraceCollector()`，收集一次运行中的事件。

这个文件不关心模型 API，也不关心工具怎么执行。

它只描述一件事：

> Agent 运行时发生了哪些可观察事件。

---

## 3. AgentEvent 是什么？

`AgentEvent` 是一个 TypeScript 联合类型。

你可以理解为 Python 里的“很多种 dict，但每种 dict 的 `type` 字段不同”。

例如：

```ts
{
  type: "tool_call_started",
  round: 1,
  toolCallId: "call_1",
  toolName: "calculator",
  args: { expression: "2 + 2" }
}
```

这里的 `type` 是事件名称。

不同 `type` 对应不同字段。

---

## 4. 当前有哪些事件？

### run_started

表示一次 Agent 运行开始。

```ts
{
  type: "run_started",
  inputMessageCount: 1,
  maxRounds: 5
}
```

含义：

- `inputMessageCount`：开始时已有多少条对话消息。
- `maxRounds`：最多允许 Agent 进行多少轮模型调用。

---

### model_call_started

表示即将请求大模型。

```ts
{
  type: "model_call_started",
  round: 1,
  messageCount: 1,
  toolCount: 3
}
```

含义：

- `round`：第几轮 Agent loop。
- `messageCount`：这次发给模型的上下文消息数量。
- `toolCount`：这次暴露给模型的工具数量。

这条事件出现时，还没有真正拿到模型回复。

---

### model_call_finished

表示模型已经返回。

```ts
{
  type: "model_call_finished",
  round: 1,
  text: "",
  toolCallCount: 1
}
```

含义：

- `text`：模型返回的文本内容。
- `toolCallCount`：模型要求调用几个工具。

如果 `toolCallCount` 是 `0`，说明模型已经给出最终回答。

如果 `toolCallCount` 大于 `0`，说明模型还没结束，它想让 Agent 先执行工具。

---

### tool_call_started

表示即将执行某个工具。

```ts
{
  type: "tool_call_started",
  round: 1,
  toolCallId: "call_echo",
  toolName: "echo",
  args: { text: "hello" }
}
```

含义：

- `toolCallId`：模型给这次工具调用分配的 ID。
- `toolName`：工具名。
- `args`：模型传给工具的参数。

---

### tool_call_finished

表示工具执行结束。

```ts
{
  type: "tool_call_finished",
  round: 1,
  toolCallId: "call_echo",
  toolName: "echo",
  output: "hello"
}
```

含义：

- `output`：工具返回给 Agent 的结果。

注意：工具结果不是直接显示给用户就完事了。

Agent 会把工具结果追加回对话上下文，再发给模型，让模型基于工具结果组织最终回答。

---

### final_reply

表示 Agent 已经拿到最终回复。

```ts
{
  type: "final_reply",
  round: 2,
  text: "The answer is 4."
}
```

这里的 `round: 2` 很常见。

因为第 1 轮模型可能先要求调用工具，第 2 轮模型才基于工具结果给最终答案。

---

### run_finished

表示一次 Agent 运行正常结束。

```ts
{
  type: "run_finished",
  roundsUsed: 2,
  toolResultCount: 1
}
```

含义：

- `roundsUsed`：实际用了几轮模型调用。
- `toolResultCount`：一共执行了几个工具调用。

---

### run_error

表示 Agent 运行失败。

```ts
{
  type: "run_error",
  message: "Model request failed: HTTP 500 - upstream failed"
}
```

常见原因：

- API key 错误。
- 模型接口返回 401、429、500。
- 网络失败。
- 模型返回格式无法解析。
- 超过最大轮数。

---

## 5. 一次工具调用的完整事件顺序

假设你问：

```text
2 + 2 等于多少？
```

模型决定调用 `calculator` 工具。

事件顺序大概是：

```text
[run] started messages=1 maxRounds=5
[model] round 1 -> messages=1 tools=3
[model] round 1 <- toolCalls=1
[tool] round 1 -> calculator args={"expression":"2 + 2"}
[tool] round 1 <- calculator result=4
[model] round 2 -> messages=3 tools=3
[model] round 2 <- toolCalls=0
[agent] round 2 final=2 + 2 = 4.
[run] finished rounds=2 toolResults=1
```

对应的 Agent loop 是：

```text
用户消息
  -> 第 1 轮请求模型
  -> 模型要求调用工具
  -> Agent 执行工具
  -> 工具结果追加进 messages
  -> 第 2 轮请求模型
  -> 模型给最终回答
  -> Agent 返回给用户
```

---

## 6. Trace Collector 是什么？

`createAgentTraceCollector()` 是一个很小的事件收集器。

用法像这样：

```ts
const trace = createAgentTraceCollector();

const result = await runToolAgent({
  messages,
  config,
  adapter,
  toolRegistry,
  onEvent: trace.onEvent,
});

console.log(trace.events);
```

它会把运行过程中的所有事件保存到 `trace.events` 数组里。

以后它可以继续扩展成：

1. 调试面板。
2. 日志文件。
3. Electron 时间线 UI。
4. Agent 运行回放。
5. 测试中的事件断言。

---

## 7. 为什么这个阶段不直接做 Electron？

Electron UI 需要展示 Agent 运行过程。

如果没有结构化事件流，UI 只能依赖终端字符串，比如：

```text
[tool] round 1 -> calculator args=...
```

这很脆弱。

现在有了 `AgentEvent`，未来 Electron 只需要监听：

```ts
onEvent(event)
```

然后根据 `event.type` 决定显示：

- 模型请求中
- 工具调用中
- 工具结果
- 最终回答
- 错误状态

这就是为什么事件流是 Electron 前的一个关键基础模块。

---

## 8. 你读代码时建议按这个顺序

建议先读：

```text
src/main/agent/agent-events.ts
```

重点看：

```ts
export type AgentEvent = ...
```

然后读：

```text
src/main/agent/tool-agent.ts
```

重点看：

```ts
emit({ type: "run_started", ... })
emit({ type: "model_call_started", ... })
emit({ type: "tool_call_started", ... })
emit({ type: "run_finished", ... })
```

最后读：

```text
src/cli/chat.ts
```

重点看：

```ts
onEvent: (event) => {
  console.log(formatAgentEventForTerminal(event));
}
```

这说明 CLI 并不知道 Agent 内部细节。

CLI 只是监听事件并打印。

---

## 9. 本阶段完成后，你应该理解什么？

读完这一阶段，你应该能理解：

1. Agent 不只是“一问一答”，它内部有运行过程。
2. Agent loop 里的模型调用和工具调用可以被拆成事件。
3. `console.log` 是展示方式，不应该是 Agent 的核心接口。
4. `AgentEvent` 是未来 UI、日志、测试、调试的共同语言。
5. 工具调用不是终点，工具结果还要回到模型，让模型生成最终回答。

如果你能根据事件顺序画出一次 Agent 运行流程，就说明这一阶段已经真正理解了一大半。
