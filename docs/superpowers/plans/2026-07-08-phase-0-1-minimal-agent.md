# Phase 0-1 Minimal Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `Cyrene-Agent-Replica-Lab`, a minimal TypeScript command-line agent that can call a DeepSeek/OpenAI-compatible chat API and print the assistant reply.

**Architecture:** This milestone intentionally avoids Electron, tools, RAG, memory, skills, Live2D, and voice. It creates a small TypeScript project with a vendor adapter, a model configuration loader, a minimal agent function, and a CLI chat entrypoint. Later phases will wrap this same core with function calling and Electron.

**Tech Stack:** Node.js 22 LTS, npm, TypeScript 5, tsx, Vitest, OpenAI-compatible HTTP chat completions.

## Global Constraints

- Project root: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab`
- Source reference root: `C:\Study\daydayup\projects\Cyrene-Agent`
- User-facing learning docs must be written in Chinese.
- Agent-facing execution plans may be written in English.
- Do not commit API keys.
- Do not implement Electron, RAG, memory, tools, skills, TTS, Live2D, MCP, scheduler, or channels in this milestone.
- Keep every file small enough for a beginner to read in one sitting.
- Prefer explicit interfaces and tests over clever abstractions.

---

## File Structure

Create these files:

```text
C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
├─ .gitignore
├─ README.md
├─ docs/
│  └─ learning/
│     └─ phase-01-minimal-agent.zh-CN.md
├─ src/
│  ├─ cli/
│  │  └─ chat.ts
│  ├─ main/
│  │  ├─ agent/
│  │  │  └─ minimal-agent.ts
│  │  ├─ config/
│  │  │  └─ model-config.ts
│  │  └─ vendors/
│  │     ├─ openai-compatible.ts
│  │     └─ types.ts
│  └─ shared/
│     └─ chat-types.ts
└─ tests/
   ├─ agent/
   │  └─ minimal-agent.test.ts
   ├─ config/
   │  └─ model-config.test.ts
   └─ vendors/
      └─ openai-compatible.test.ts
```

Responsibilities:

- `package.json`: npm scripts and dependencies.
- `tsconfig.json`: TypeScript compiler options for Node.js ESM.
- `vitest.config.ts`: Vitest test configuration.
- `.gitignore`: local secrets, build output, dependency folders.
- Local `.env`: user-created model configuration, ignored by git.
- `README.md`: minimal English agent-facing project overview.
- `docs/learning/phase-01-minimal-agent.zh-CN.md`: Chinese learner-facing explanation.
- `src/shared/chat-types.ts`: shared `ChatMessage` types.
- `src/main/vendors/types.ts`: vendor adapter interfaces.
- `src/main/vendors/openai-compatible.ts`: OpenAI-compatible request/response adapter.
- `src/main/config/model-config.ts`: environment-based model config loader.
- `src/main/agent/minimal-agent.ts`: minimal `runMinimalAgent` function.
- `src/cli/chat.ts`: terminal chat program.
- `tests/**`: focused unit tests.

---

### Task 1: Create Project Scaffold

**Files:**
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\package.json`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tsconfig.json`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\vitest.config.ts`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\.gitignore`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\README.md`

**Interfaces:**
- Consumes: none.
- Produces: npm project that can install dependencies, run tests, typecheck, and start the CLI.

- [ ] **Step 1: Create `package.json`**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\package.json`:

```json
{
  "name": "cyrene-agent-replica-lab",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Learning-oriented Cyrene-Agent replica lab",
  "scripts": {
    "dev:chat": "tsx src/cli/chat.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"],
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
*.log
```

- [ ] **Step 5: Use a local `.env` when running**

Do not commit API keys. Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\.env` manually when running locally.

- [ ] **Step 6: Create `README.md`**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\README.md`:

```markdown
# Cyrene-Agent Replica Lab

This is a learning-oriented TypeScript + Electron replica of Cyrene-Agent.

Current milestone:

- Phase 0: project scaffold
- Phase 1: minimal terminal chat agent

Run tests:

```bash
npm test
```

Run the terminal chat after setting environment variables:

```bash
npm run dev:chat
```

Never commit API keys.
```

- [ ] **Step 7: Install dependencies**

Run:

```powershell
cd /d C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab
npm install
```

Expected:

```text
added ... packages
```

The exact package count may vary.

- [ ] **Step 8: Verify baseline scripts**

Run:

```powershell
npm test
npm run typecheck
```

Expected for `npm test` before tests are added:

```text
No test files found
```

Expected for typecheck:

```text
exit code 0
```

If Vitest exits non-zero because no tests exist, continue; Task 2 adds tests.

---

### Task 2: Define Shared Chat Types

**Files:**
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\shared\chat-types.ts`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\agent\minimal-agent.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `ChatRole = "system" | "user" | "assistant"`
  - `ChatMessage { role: ChatRole; content: string }`
  - `createUserMessage(content: string): ChatMessage`

- [ ] **Step 1: Write failing type/constructor test**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\agent\minimal-agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createUserMessage } from "../../src/shared/chat-types.js";

describe("chat types", () => {
  it("creates a user message", () => {
    expect(createUserMessage("hello")).toEqual({
      role: "user",
      content: "hello",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/agent/minimal-agent.test.ts
```

Expected:

```text
FAIL
Cannot find module '../../src/shared/chat-types.js'
```

- [ ] **Step 3: Implement shared chat types**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\shared\chat-types.ts`:

```ts
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export function createUserMessage(content: string): ChatMessage {
  return {
    role: "user",
    content,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- tests/agent/minimal-agent.test.ts
```

Expected:

```text
PASS tests/agent/minimal-agent.test.ts
```

---

### Task 3: Implement Model Configuration Loader

**Files:**
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\config\model-config.ts`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\config\model-config.test.ts`

**Interfaces:**
- Consumes: environment-like record.
- Produces:
  - `ModelConfig`
  - `loadModelConfig(env?: NodeJS.ProcessEnv): ModelConfig`
  - Throws clear error when API key is missing.

- [ ] **Step 1: Write failing config tests**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\config\model-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadModelConfig } from "../../src/main/config/model-config.js";

describe("loadModelConfig", () => {
  it("loads explicit environment values", () => {
    const config = loadModelConfig({
      CYRENE_MODEL_PROVIDER: "deepseek",
      CYRENE_MODEL_BASE_URL: "https://api.deepseek.com",
      CYRENE_MODEL_NAME: "deepseek-chat",
      CYRENE_MODEL_API_KEY: "sk-test",
    });

    expect(config).toEqual({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-test",
    });
  });

  it("uses safe defaults except for the API key", () => {
    const config = loadModelConfig({
      CYRENE_MODEL_API_KEY: "sk-test",
    });

    expect(config.provider).toBe("deepseek");
    expect(config.baseUrl).toBe("https://api.deepseek.com");
    expect(config.model).toBe("deepseek-chat");
    expect(config.apiKey).toBe("sk-test");
  });

  it("throws when the API key is missing", () => {
    expect(() => loadModelConfig({})).toThrow("CYRENE_MODEL_API_KEY is required");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/config/model-config.test.ts
```

Expected:

```text
FAIL
Cannot find module '../../src/main/config/model-config.js'
```

- [ ] **Step 3: Implement config loader**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\config\model-config.ts`:

```ts
export interface ModelConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return typeof env[key] === "string" ? env[key]!.trim() : "";
}

export function loadModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const apiKey = readEnv(env, "CYRENE_MODEL_API_KEY");
  if (!apiKey) {
    throw new Error("CYRENE_MODEL_API_KEY is required");
  }

  return {
    provider: readEnv(env, "CYRENE_MODEL_PROVIDER") || "deepseek",
    baseUrl: readEnv(env, "CYRENE_MODEL_BASE_URL") || "https://api.deepseek.com",
    model: readEnv(env, "CYRENE_MODEL_NAME") || "deepseek-chat",
    apiKey,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- tests/config/model-config.test.ts
```

Expected:

```text
PASS tests/config/model-config.test.ts
```

---

### Task 4: Implement OpenAI-Compatible Vendor Adapter

**Files:**
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\vendors\types.ts`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\vendors\openai-compatible.ts`
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\vendors\openai-compatible.test.ts`

**Interfaces:**
- Consumes:
  - `ChatMessage[]`
  - `ModelConfig`
- Produces:
  - `VendorHttpRequest`
  - `ChatCompletionResult`
  - `OpenAICompatibleAdapter`
  - `openAICompatibleAdapter.buildRequest(input, config)`
  - `openAICompatibleAdapter.parseResponse(data)`

- [ ] **Step 1: Write failing adapter tests**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\vendors\openai-compatible.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openAICompatibleAdapter } from "../../src/main/vendors/openai-compatible.js";

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

describe("openAICompatibleAdapter", () => {
  it("builds a chat completions request", () => {
    const request = openAICompatibleAdapter.buildRequest(
      {
        messages: [{ role: "user", content: "hello" }],
      },
      config,
    );

    expect(request.url).toBe("https://api.deepseek.com/chat/completions");
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(request.body)).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
  });

  it("parses assistant text from an OpenAI-compatible response", () => {
    const result = openAICompatibleAdapter.parseResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: "你好",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
      },
    });

    expect(result).toEqual({
      text: "你好",
      finishReason: "stop",
      usage: {
        input: 10,
        output: 5,
      },
    });
  });

  it("returns empty text when the response has no assistant content", () => {
    const result = openAICompatibleAdapter.parseResponse({ choices: [] });
    expect(result.text).toBe("");
    expect(result.finishReason).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/vendors/openai-compatible.test.ts
```

Expected:

```text
FAIL
Cannot find module '../../src/main/vendors/openai-compatible.js'
```

- [ ] **Step 3: Implement vendor types**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\vendors\types.ts`:

```ts
import type { ChatMessage } from "../../shared/chat-types.js";
import type { ModelConfig } from "../config/model-config.js";

export interface ChatCompletionInput {
  messages: ChatMessage[];
}

export interface VendorHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface ChatCompletionResult {
  text: string;
  finishReason: string;
  usage?: {
    input: number;
    output: number;
  };
}

export interface VendorAdapter {
  readonly id: string;
  buildRequest(input: ChatCompletionInput, config: ModelConfig): VendorHttpRequest;
  parseResponse(data: unknown): ChatCompletionResult;
}
```

- [ ] **Step 4: Implement OpenAI-compatible adapter**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\vendors\openai-compatible.ts`:

```ts
import type { VendorAdapter } from "./types.js";

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function asResponse(data: unknown): OpenAICompatibleResponse {
  return data && typeof data === "object" ? (data as OpenAICompatibleResponse) : {};
}

export const openAICompatibleAdapter: VendorAdapter = {
  id: "openai-compatible",

  buildRequest(input, config) {
    return {
      url: `${trimTrailingSlash(config.baseUrl)}/chat/completions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: input.messages,
        stream: false,
      }),
    };
  },

  parseResponse(data) {
    const response = asResponse(data);
    const firstChoice = response.choices?.[0];
    const text = firstChoice?.message?.content ?? "";
    const finishReason = firstChoice?.finish_reason ?? "unknown";
    const usage = response.usage
      ? {
          input: response.usage.prompt_tokens ?? 0,
          output: response.usage.completion_tokens ?? 0,
        }
      : undefined;

    return {
      text,
      finishReason,
      ...(usage ? { usage } : {}),
    };
  },
};
```

- [ ] **Step 5: Run adapter tests**

Run:

```powershell
npm test -- tests/vendors/openai-compatible.test.ts
```

Expected:

```text
PASS tests/vendors/openai-compatible.test.ts
```

---

### Task 5: Implement Minimal Agent Function

**Files:**
- Modify: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\agent\minimal-agent.ts`
- Modify: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\agent\minimal-agent.test.ts`

**Interfaces:**
- Consumes:
  - `ChatMessage[]`
  - `ModelConfig`
  - `VendorAdapter`
  - injected `fetch`
- Produces:
  - `runMinimalAgent(input): Promise<string>`

- [ ] **Step 1: Replace agent test with minimal agent behavior tests**

Replace `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\tests\agent\minimal-agent.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { runMinimalAgent } from "../../src/main/agent/minimal-agent.js";
import { createUserMessage } from "../../src/shared/chat-types.js";
import { openAICompatibleAdapter } from "../../src/main/vendors/openai-compatible.js";

const config = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "sk-test",
};

describe("runMinimalAgent", () => {
  it("calls the model and returns assistant text", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "你好，我是学习版 Agent。",
            },
            finish_reason: "stop",
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const reply = await runMinimalAgent({
      messages: [createUserMessage("hello")],
      config,
      adapter: openAICompatibleAdapter,
      fetchImpl: fetchMock,
    });

    expect(reply).toBe("你好，我是学习版 Agent。");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws a clear error when the model request fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    })) as unknown as typeof fetch;

    await expect(
      runMinimalAgent({
        messages: [createUserMessage("hello")],
        config,
        adapter: openAICompatibleAdapter,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("Model request failed: HTTP 401");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- tests/agent/minimal-agent.test.ts
```

Expected:

```text
FAIL
Cannot find module '../../src/main/agent/minimal-agent.js'
```

- [ ] **Step 3: Implement minimal agent**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\main\agent\minimal-agent.ts`:

```ts
import type { ChatMessage } from "../../shared/chat-types.js";
import type { ModelConfig } from "../config/model-config.js";
import type { VendorAdapter } from "../vendors/types.js";

export interface RunMinimalAgentInput {
  messages: ChatMessage[];
  config: ModelConfig;
  adapter: VendorAdapter;
  fetchImpl?: typeof fetch;
}

export async function runMinimalAgent(input: RunMinimalAgentInput): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = input.adapter.buildRequest(
    { messages: input.messages },
    input.config,
  );

  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? ` - ${body.slice(0, 200)}` : "";
    throw new Error(`Model request failed: HTTP ${response.status}${detail}`);
  }

  const data = await response.json();
  return input.adapter.parseResponse(data).text;
}
```

- [ ] **Step 4: Run agent tests**

Run:

```powershell
npm test -- tests/agent/minimal-agent.test.ts
```

Expected:

```text
PASS tests/agent/minimal-agent.test.ts
```

---

### Task 6: Implement Terminal Chat CLI

**Files:**
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\cli\chat.ts`

**Interfaces:**
- Consumes:
  - `loadModelConfig()`
  - `runMinimalAgent()`
  - `openAICompatibleAdapter`
- Produces:
  - interactive terminal command `npm run dev:chat`

- [ ] **Step 1: Create CLI chat file**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\src\cli\chat.ts`:

```ts
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runMinimalAgent } from "../main/agent/minimal-agent.js";
import { loadModelConfig } from "../main/config/model-config.js";
import { openAICompatibleAdapter } from "../main/vendors/openai-compatible.js";
import type { ChatMessage } from "../shared/chat-types.js";

const SYSTEM_PROMPT = [
  "You are Cyrene Replica Lab, a minimal learning agent.",
  "Answer clearly and briefly.",
  "When explaining technical ideas, use beginner-friendly wording.",
].join("\n");

async function main(): Promise<void> {
  const config = loadModelConfig();
  const rl = readline.createInterface({ input, output });
  const history: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  console.log("Cyrene Agent Replica Lab - terminal chat");
  console.log("Type /exit to quit.");

  try {
    while (true) {
      const text = (await rl.question("\nYou> ")).trim();
      if (!text) continue;
      if (text === "/exit") break;

      history.push({ role: "user", content: text });

      try {
        const reply = await runMinimalAgent({
          messages: history,
          config,
          adapter: openAICompatibleAdapter,
        });
        history.push({ role: "assistant", content: reply });
        console.log(`\nAgent> ${reply}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n[error] ${message}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fatal] ${message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected:

```text
exit code 0
```

- [ ] **Step 3: Run all tests**

Run:

```powershell
npm test
```

Expected:

```text
PASS tests/agent/minimal-agent.test.ts
PASS tests/config/model-config.test.ts
PASS tests/vendors/openai-compatible.test.ts
```

- [ ] **Step 4: Manually run terminal chat**

In PowerShell:

```powershell
cd /d C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab
$env:CYRENE_MODEL_PROVIDER="deepseek"
$env:CYRENE_MODEL_BASE_URL="https://api.deepseek.com"
$env:CYRENE_MODEL_NAME="deepseek-chat"
$env:CYRENE_MODEL_API_KEY="YOUR_REAL_API_KEY"
npm run dev:chat
```

Expected:

```text
Cyrene Agent Replica Lab - terminal chat
Type /exit to quit.

You>
```

Type:

```text
你好，请用一句话介绍你自己
```

Expected:

```text
Agent> ...
```

The exact model reply will vary.

---

### Task 7: Write Chinese Learning Note

**Files:**
- Create: `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\docs\learning\phase-01-minimal-agent.zh-CN.md`

**Interfaces:**
- Consumes: completed Phase 0-1 code.
- Produces: Chinese learner-facing explanation of the minimal agent loop.

- [ ] **Step 1: Create the learning document**

Create `C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\docs\learning\phase-01-minimal-agent.zh-CN.md`:

```markdown
# Phase 1：最小 Agent Loop

这一阶段只实现一个最小闭环：

```text
用户输入
↓
构造 messages
↓
调用 DeepSeek / OpenAI-compatible API
↓
解析 assistant 回复
↓
打印到终端
```

这个阶段还没有：

```text
Electron
工具调用
RAG
记忆系统
skills
Live2D
语音
```

## 为什么先做这个

所有复杂 Agent 都离不开最基础的模型调用。

后面的工具调用、RAG、记忆系统，本质上都是在这条链路上增加上下文或动作能力：

```text
普通聊天 = 用户消息 + 模型回复
工具 Agent = 用户消息 + 工具列表 + 模型决定调用工具
RAG Agent = 用户消息 + 检索到的资料 + 模型回复
记忆 Agent = 用户消息 + 用户画像/历史记忆 + 模型回复
```

所以先把最小聊天跑通，是整个复刻项目的第一块地基。

## 文件说明

```text
src/shared/chat-types.ts
```

定义聊天消息格式：

```ts
{
  role: "system" | "user" | "assistant",
  content: string
}
```

```text
src/main/config/model-config.ts
```

从环境变量读取模型配置：

```text
CYRENE_MODEL_PROVIDER
CYRENE_MODEL_BASE_URL
CYRENE_MODEL_NAME
CYRENE_MODEL_API_KEY
```

```text
src/main/vendors/openai-compatible.ts
```

负责把通用消息转换成 OpenAI-compatible HTTP 请求，并解析响应。

```text
src/main/agent/minimal-agent.ts
```

负责真正执行一次模型调用。

```text
src/cli/chat.ts
```

提供终端聊天入口。

## 和源项目的关系

源项目里类似职责分散在：

```text
src/main/orchestrator/vendors
src/main/orchestrator/function-calling.ts
src/main/index.ts
```

学习版先把它简化成：

```text
config
vendor adapter
minimal agent
cli
```

这样更容易看清楚一条消息是怎么从用户输入变成模型回复的。

## 下一阶段

下一阶段会加入：

```text
ToolDefinition
ToolRegistry
Function Calling
工具执行
工具结果回填
```

到那时，Agent 就不只是“回答”，还可以“行动”。
```

- [ ] **Step 2: Check the Chinese learning document**

Run:

```powershell
rg -n "TODO|TBD|FIXME|待补|占位" docs/learning/phase-01-minimal-agent.zh-CN.md
```

Expected:

```text
no matches
```

---

## Self-Review Checklist

- [ ] Phase 0 creates a valid TypeScript project.
- [ ] Phase 1 creates a terminal-only chat loop.
- [ ] No Electron code is introduced.
- [ ] No RAG, memory, tools, skills, TTS, Live2D, MCP, scheduler, or channels are introduced.
- [ ] API keys stay outside source code.
- [ ] Tests cover config loading, adapter request/response parsing, and the minimal agent call.
- [ ] User-facing learning document is written in Chinese.

## Execution Handoff

Plan complete and saved to:

```text
C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\docs\superpowers\plans\2026-07-08-phase-0-1-minimal-agent.md
```

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Ask the user which approach they prefer before implementing code.
