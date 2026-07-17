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

Full verification:

```bash
npm test
npm run typecheck
npm run build
npm run test:embedding
npm run test:mcp
npm run test:electron-smoke
```
