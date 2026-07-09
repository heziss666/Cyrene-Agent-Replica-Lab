# Cyrene-Agent Replica Lab

This is a learning-oriented TypeScript + Electron replica of Cyrene-Agent.

Current milestone:

- Phase 0: project scaffold
- Phase 1: minimal terminal chat agent
- Phase 2: terminal tool-calling agent loop

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
