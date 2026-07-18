# Cyrene-Agent 复刻项目总体路线图

## 项目目标

在 `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab` 中，从最小 Agent 开始，逐步实现工具调用、Electron、RAG、长期记忆、Skills、MCP、调度、语音和 Live2D。

原则：每个阶段都能运行、能测试、能解释；参考源项目，但允许修复冗余和结构问题。

## 技术栈

- TypeScript、Node.js 22 LTS；
- Electron、Chromium、Preload、IPC；
- Vite、Vitest；
- DeepSeek/OpenAI-compatible Chat API；
- Ollama `qwen3-embedding:4b`；
- JSON 原子存储和本地向量索引。

## 阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | 项目骨架和环境 | 完成 |
| Phase 1 | 最小终端 Agent | 完成 |
| Phase 2 | Vendor Adapter | 完成 |
| Phase 3 | Tool Registry 与 Agent Loop | 完成 |
| Phase 4 | Electron main/preload/renderer | 完成 |
| Phase 5 | 聊天 UI、会话和事件流 | 完成 |
| Phase 6 | 文档 RAG、Ollama embedding、持久向量索引 | 完成 |
| Phase 7 | Schema v2、治理、冲突、生命周期、Reflection、压缩、实体图 | 完成 |
| Phase 8 | 本地 Skills、渐进加载、管理 UI 与内置教学 Skill | 完成 |
| Phase 9 | MCP 外部工具、双 Transport、权限审批和管理 UI | 完成 |
| Phase 10 | Scheduler 定时任务扩展 | 待开始 |
| Phase 11 | Voice | 暂缓 |
| Phase 12 | Live2D 和主动交互 | 暂缓 |
| Phase 13 | 外部 Channels | 待开始 |
| Phase 14 | 总体对齐、性能、安全和发布 | 待开始 |

## 当前阅读顺序

1. `README.md`：运行方式；
2. `docs/learning/phase-09-mcp.zh-CN.md`：MCP 外部工具系统；
3. `docs/learning/phase-08-skills-system.zh-CN.md`：Skills 系统；
4. `docs/learning/phase-07-complete-memory-system.zh-CN.md`：完整记忆系统；
5. `src/main/app/main.ts`：Electron Main 的运行时组装；
6. `src/main/app/register-chat-ipc.ts`：一轮聊天的完整调用链；
7. `src/main/mcp`：MCP 子系统；
8. `tests`：行为契约和失败路径。

## Phase 7 的三个子阶段

- 7B：Schema v2、治理 UI、冲突检测和自动 Resolver；
- 7C：访问强化、衰减、L1 过期、Scheduler 和关机屏障；
- 7D：Reflection/verifier、Profile 晋升、语义聚类、两阶段压缩和实体图。

完整说明见 [Phase 7 中文指南](phase-07-complete-memory-system.zh-CN.md)。

## 通用验收

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:embedding
npm.cmd run dev:electron
```

API Key 只写入本地 `.env`，禁止提交到 Git。
# Phase 10 补充：Agent Scheduler

Phase 10 已完成持久化定时任务、一次性/间隔/Cron 时间规则、错过任务策略、隔离 Agent 执行、运行历史、Electron Tasks 页面、系统通知和关闭排空。详细说明见 `phase-10-agent-scheduler.zh-CN.md`。
