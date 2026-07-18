# Cyrene-Agent 复刻项目总体路线图

## 项目目标

在 `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab` 中，从最小 Agent 开始，逐步实现工具调用、Electron、RAG、长期记忆、Skills、MCP、调度、可靠运行时，最后再考虑语音、Live2D 和外部渠道。

原则：每个阶段都能运行、能测试、能解释；参考源项目，但允许修复冗余和结构问题。

## 技术栈

- TypeScript、Node.js 22 LTS；
- Electron、Chromium、Preload、IPC；
- Vite、Vitest；
- DeepSeek/OpenAI-compatible Chat API；
- Ollama `qwen3-embedding:4b`；
- JSON 原子存储和本地向量索引。

## 当前阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0-5 | 骨架、Vendor、工具 Agent Loop、事件、Electron 和聊天 UI | 完成 |
| Phase 6 | 文档 RAG、Ollama Embedding、持久向量索引、角色知识 | 完成 |
| Phase 7 | 长期记忆、治理、冲突、生命周期、反思、压缩和实体图 | 完成 |
| Phase 8 | 本地 Skills、渐进加载、手动激活和管理 UI | 完成 |
| Phase 9 | MCP 外部工具、双 Transport、审批和管理 UI | 完成 |
| Phase 10 | Scheduler 定时任务、隔离执行、历史和通知 | 完成 |
| Phase 11 | 多会话持久化、上下文预算、摘要和旧消息检索 | 完成 |
| Phase 12 | 流式响应、受控并发、取消、Trace、Runs 页面和共享运行时 | 完成 |
| 后续 | 语音、Live2D、外部 Channels、发布和性能优化 | 待规划 |

## 推荐阅读顺序

1. `README.md`：运行方式和系统入口；
2. `phase-11-context-and-multi-session.zh-CN.md`：会话和上下文；
3. `phase-12-reliable-streaming-runs.zh-CN.md`：当前可靠运行时；
4. `src/main/app/main.ts`：Electron Main 的依赖组装；
5. `src/main/app/register-chat-ipc.ts`：一轮聊天的完整调用链；
6. `src/main/runs`：排队、取消、Trace 和持久化；
7. `src/renderer/chat`：界面状态和 IPC 事件消费；
8. `tests`：行为契约和失败路径。

## 通用验收

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:streaming
npm.cmd run test:electron-smoke
npm.cmd run test:embedding
npm.cmd run test:mcp
npm.cmd run test:scheduler
```

API Key 只写入本地 `.env`，禁止提交到 Git。
