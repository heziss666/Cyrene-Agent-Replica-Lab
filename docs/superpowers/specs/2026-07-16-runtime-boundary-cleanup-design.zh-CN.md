# Runtime 边界整理设计

## 目标

消除 Electron 后台对 `src/cli/chat.ts` 的反向依赖，并删除已经被
`tool-agent.ts` 取代的最小 Agent 教学实现，同时保持现有终端聊天、
Electron、工具调用、RAG 和记忆行为不变。

## 设计

新增 `src/main/runtime/agent-runtime.ts`，集中提供：

- `loadRuntimeModelConfig()`：加载 `.env` 和模型配置；
- `createRuntimeToolRegistry()`：创建默认工具注册表；
- `createRuntimePromptComposer()`：创建 Prompt 组合器；
- `buildModelMessages()`：把一条 System 消息放在会话历史前面。

`src/cli/chat.ts` 只保留终端输入、输出和循环，通过 Runtime 模块取得公共依赖。
`main.ts` 与 `register-chat-ipc.ts` 直接依赖 Runtime 模块，不再依赖 CLI。

删除：

- `src/main/agent/minimal-agent.ts`；
- `tests/agent/minimal-agent.test.ts`。

早期计划文档作为学习历史保留；Phase 1 学习文档增加当前状态说明，避免读者误以为
`minimal-agent.ts` 仍属于现行代码。

## 不做的内容

- 不把终端聊天升级为完整记忆流程；
- 不把 `register-chat-ipc.ts` 重写成新的 ChatService；
- 不改变 System Prompt、工具、会话、RAG 或记忆行为；
- 不删除历史阶段计划。

## 测试

- Runtime 单元测试覆盖四个公共函数；
- CLI 测试只验证终端入口相关行为；
- 删除最小 Agent 的专属测试；
- 运行全量测试、TypeScript 类型检查和 Electron/Renderer 构建。
