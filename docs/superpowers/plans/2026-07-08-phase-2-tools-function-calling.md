# Phase 2 Tools + Function Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the terminal learning agent from single-shot chat to a minimal OpenAI-compatible tool-calling agent loop.

**Architecture:** Add a small tool registry, three safe built-in tools, OpenAI-compatible tool request/response support, and a new `runToolAgent` loop. Keep Phase 1 `runMinimalAgent` intact for comparison, but make the CLI use the new tool agent.

**Tech Stack:** Node.js 22 LTS, npm, TypeScript 5, Vitest, OpenAI-compatible `/chat/completions` tool calling.

## Global Constraints

- Project root: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab`
- User-facing learning docs must be written in Chinese.
- Do not commit API keys.
- Do not implement Electron, RAG, memory, MCP, scheduler, TTS, Live2D, shell execution, or file access in this milestone.
- Keep every file small enough for a beginner to read in one sitting.
- Use TDD for behavior changes.
- Keep `runMinimalAgent` working for Phase 1 comparison.
- CLI should use the new tool agent after this phase.

---

## File Structure

Create:

```text
src/main/tools/tool-types.ts
src/main/tools/tool-registry.ts
src/main/tools/built-in-tools.ts
src/main/agent/tool-agent.ts
tests/tools/tool-registry.test.ts
tests/tools/built-in-tools.test.ts
tests/agent/tool-agent.test.ts
docs/learning/phase-02-tools-function-calling.zh-CN.md
```

Modify:

```text
src/shared/chat-types.ts
src/main/vendors/types.ts
src/main/vendors/openai-compatible.ts
src/cli/chat.ts
tests/vendors/openai-compatible.test.ts
tests/cli/chat.test.ts
```

Responsibilities:

- `tool-types.ts`: JSON schema, tool definition, tool call, and tool execution result types.
- `tool-registry.ts`: small registry class for registering and retrieving enabled tools.
- `built-in-tools.ts`: safe built-in tools: `get_current_time`, `calculator`, `echo`.
- `tool-agent.ts`: loop that calls the model, executes requested tools, appends tool results, and repeats.
- `chat-types.ts`: extend chat messages to include `role:"tool"` and optional tool metadata.
- `vendors/types.ts`: extend adapter input/result interfaces for tools.
- `openai-compatible.ts`: build OpenAI-compatible `tools` payloads, parse `tool_calls`, append tool result messages.
- `chat.ts`: use `runToolAgent` and a default tool registry.

## Tasks

### Task 1: Tool Types And Registry

**Files:**
- Create: `src/main/tools/tool-types.ts`
- Create: `src/main/tools/tool-registry.ts`
- Create: `tests/tools/tool-registry.test.ts`

**Interfaces:**
- Produces `ToolDefinition`, `ToolCall`, `ToolExecutionResult`, `ToolRegistry`.

Steps:

- [ ] Write failing registry tests for registering tools, listing enabled tools, and finding tools by id.
- [ ] Run `npm.cmd test -- tests/tools/tool-registry.test.ts` and confirm it fails because files are missing.
- [ ] Implement `tool-types.ts` and `tool-registry.ts`.
- [ ] Run `npm.cmd test -- tests/tools/tool-registry.test.ts` and confirm it passes.

### Task 2: Built-In Tools

**Files:**
- Create: `src/main/tools/built-in-tools.ts`
- Create: `tests/tools/built-in-tools.test.ts`

**Interfaces:**
- Produces `createDefaultToolRegistry(): ToolRegistry`.
- Built-in tool ids: `get_current_time`, `calculator`, `echo`.

Steps:

- [ ] Write failing tests for `echo`, `calculator`, and `get_current_time`.
- [ ] Run `npm.cmd test -- tests/tools/built-in-tools.test.ts` and confirm it fails because implementation is missing.
- [ ] Implement the three built-in tools.
- [ ] Run `npm.cmd test -- tests/tools/built-in-tools.test.ts` and confirm it passes.

### Task 3: Vendor Tool Calling Support

**Files:**
- Modify: `src/shared/chat-types.ts`
- Modify: `src/main/vendors/types.ts`
- Modify: `src/main/vendors/openai-compatible.ts`
- Modify: `tests/vendors/openai-compatible.test.ts`

**Interfaces:**
- `ChatMessage.role` includes `"tool"`.
- `ChatCompletionInput` accepts optional `tools`.
- `ChatCompletionResult` includes `assistantMessage` and `toolCalls`.
- `VendorAdapter` adds `appendToolResults(messages, results)`.

Steps:

- [ ] Extend vendor tests to assert OpenAI-compatible tools are sent in request body.
- [ ] Extend vendor tests to assert OpenAI-compatible `tool_calls` are parsed.
- [ ] Extend vendor tests to assert tool results append `role:"tool"` messages.
- [ ] Run `npm.cmd test -- tests/vendors/openai-compatible.test.ts` and confirm failures.
- [ ] Implement type and adapter changes.
- [ ] Run `npm.cmd test -- tests/vendors/openai-compatible.test.ts` and confirm it passes.
- [ ] Run `npm.cmd test -- tests/agent/minimal-agent.test.ts` and confirm Phase 1 still passes.

### Task 4: Tool Agent Loop

**Files:**
- Create: `src/main/agent/tool-agent.ts`
- Create: `tests/agent/tool-agent.test.ts`

**Interfaces:**
- Produces `runToolAgent(input): Promise<ToolAgentResult>`.
- `ToolAgentResult` contains `reply`, `messages`, and `toolResults`.

Steps:

- [ ] Write failing tests for a no-tool response.
- [ ] Write failing tests for one tool call followed by a final response.
- [ ] Write failing tests for unknown tool handling.
- [ ] Run `npm.cmd test -- tests/agent/tool-agent.test.ts` and confirm failures.
- [ ] Implement `runToolAgent`.
- [ ] Run `npm.cmd test -- tests/agent/tool-agent.test.ts` and confirm it passes.

### Task 5: CLI Uses Tool Agent

**Files:**
- Modify: `src/cli/chat.ts`
- Modify: `tests/cli/chat.test.ts`

**Interfaces:**
- CLI should call `createDefaultToolRegistry()`.
- CLI should call `runToolAgent()`.
- CLI history should continue to include the returned full conversation messages.

Steps:

- [ ] Update CLI tests to verify a default registry contains built-in tools.
- [ ] Run `npm.cmd test -- tests/cli/chat.test.ts`.
- [ ] Modify `chat.ts` to use `runToolAgent`.
- [ ] Run `npm.cmd test -- tests/cli/chat.test.ts`.
- [ ] Run `npm.cmd run typecheck`.

### Task 6: Chinese Learning Doc

**Files:**
- Create: `docs/learning/phase-02-tools-function-calling.zh-CN.md`
- Modify: `README.md`

**Interfaces:**
- Produces learner-facing Chinese explanation of tool calling.

Steps:

- [ ] Write the Chinese learning document.
- [ ] Update README current milestone.
- [ ] Run an unfinished-marker scan on `docs/learning/phase-02-tools-function-calling.zh-CN.md` and `README.md`.
- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run CLI smoke test with `/exit`.

## Self-Review Checklist

- Tool calls are represented in project-owned types, not only raw OpenAI JSON.
- OpenAI-compatible adapter owns OpenAI wire format conversion.
- The agent loop does not contain provider-specific branching.
- Unknown tools and invalid arguments become tool results instead of crashing the whole loop.
- `runMinimalAgent` remains available and tested.
- CLI uses `runToolAgent`.
- No unsafe file, shell, Electron, RAG, memory, MCP, or Live2D code is introduced.
