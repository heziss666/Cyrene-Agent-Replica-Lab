# Cyrene-Agent Replica Lab

This is a learning-oriented TypeScript + Electron replica of Cyrene-Agent.

Current milestone:

- Phase 0: project scaffold
- Phase 1: minimal terminal chat agent
- Phase 2: terminal tool-calling agent loop
- Phase 6: persistent Ollama-backed RAG
- Phase 7: governed long-term memory, lifecycle maintenance, verified reflection, two-stage compression, and a rebuildable entity graph
- Phase 8: safe local Skills, progressive loading, manual activation, persistence, and Electron management UI
- Phase 9: MCP stdio/Streamable HTTP tools, runtime discovery, approvals, reconnect, and Electron management UI
- Phase 10: persistent scheduled Agent tasks, Cron/interval/one-time schedules, isolated execution, run history, notifications, and Electron management UI
- Phase 11: persistent multi-session conversations, context budgeting, summaries, and old-message retrieval
- Phase 12: streaming replies, controlled concurrency, cancellation, persistent sanitized traces, shared Chat/Scheduler runs, and Runs diagnostics UI

Run tests:

```bash
npm test
```

Run the terminal chat after setting environment variables:

```bash
npm run dev:chat
```

Or create a local `.env`, fill in `CYRENE_MODEL_API_KEY`, then run:

```bash
npm run dev:chat
```

Never commit API keys.

## Memory system

The Electron Memory view includes Overview, Profile, Events, Conflicts, Reflections, Relations, and Audit tabs. Maintenance can run automatically or from the Overview action.

Chinese learning guide: [`docs/learning/phase-07-complete-memory-system.zh-CN.md`](docs/learning/phase-07-complete-memory-system.zh-CN.md)

## Skills system

The Electron Skills view lists builtin and user Skills, persists enable state, and rescans fixed local roots. Skill bodies and references are loaded progressively through `invoke_skill` and `read_skill_reference`; Skills do not grant new permissions.

Manual activation uses `/skill-id task`, for example:

```text
/agent-learning-tutor explain ToolRegistry
```

Chinese learning guide: [`docs/learning/phase-08-skills-system.zh-CN.md`](docs/learning/phase-08-skills-system.zh-CN.md)

## MCP system

The Electron MCP view manages local stdio and Streamable HTTP servers. External tools are discovered at runtime and adapted into the same ToolRegistry used by builtin and Skill tools. Sensitive calls require approval unless the server is explicitly trusted.

Protocol smoke test:

```bash
npm run test:mcp
```

Chinese learning guide: [`docs/learning/phase-09-mcp.zh-CN.md`](docs/learning/phase-09-mcp.zh-CN.md)

## Scheduler system

The Electron Tasks view creates one-time, interval, and five-field Cron tasks. Scheduled runs use the current persona, memory recall, Skills catalog, builtin tools, and connected MCP tools in an isolated Agent Loop. Sensitive MCP calls remain approval-gated and may produce a `needs_attention` run.

Scheduler smoke test:

```bash
npm run test:scheduler
```

Chinese learning guide: [`docs/learning/phase-10-agent-scheduler.zh-CN.md`](docs/learning/phase-10-agent-scheduler.zh-CN.md)

## Reliable streaming runs

Chat replies stream through sequence-numbered IPC events. Chat and Scheduler share a two-slot AgentRunManager, while each conversation keeps one active top-level run. Partial cancelled replies are preserved for display but excluded from future model context.

```bash
npm run test:streaming
```

Chinese learning guide: [`docs/learning/phase-12-reliable-streaming-runs.zh-CN.md`](docs/learning/phase-12-reliable-streaming-runs.zh-CN.md)

Full verification:

```bash
npm test
npm run typecheck
npm run build
npm run test:embedding
npm run test:mcp
npm run test:scheduler
npm run test:streaming
npm run test:electron-smoke
```
