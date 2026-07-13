# Phase 6D Cyrene Persona, Styles, and Worldbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable Cyrene text persona, five in-conversation reply styles, a section-aware worldbook corpus, and repeatable Ollama RAG benchmarks without adding voice or call features.

**Architecture:** Runtime model requests are assembled from one fresh system message plus session-owned user/assistant/tool history. Core persona files and the active style are always present in the system prompt, while worldbook sections and canon quotes are loaded into the existing Ollama-backed vector RAG. Style changes preserve history and add a request-only transition instruction until the next successful model response.

**Tech Stack:** TypeScript 5.7, Node.js 22, Electron 43, Vite 5, Vitest 2, Ollama `qwen3-embedding:4b`, OpenAI-compatible chat APIs, JSON vector index.

## Global Constraints

- User-facing learning documentation must be written in Chinese; this internal implementation plan remains in English.
- Do not add ASR, TTS, microphone, audio playback, Live2D, phone prompts, `talk_system.md`, or call-window code.
- Do not enable `cyrene-original-voice`; copy it only as an inactive learning snapshot.
- Do not implement the upstream DMAE worldbook activation algorithm in Phase 6D.
- Preserve current `search_knowledge({ query, topK? })` tool arguments.
- Keep Ollama fallback behavior: vector failures fall back to keyword retrieval.
- Preserve chat history during style changes; do not create a new chat automatically.
- Persist only the last selected global style, not conversation history.
- Treat core persona file absence as a startup/configuration error, not a silent fallback.
- Keep source character-IP attribution and the upstream MIT license with the imported snapshot.
- Use TDD for every behavior change and make one focused commit per task.

---

## File Structure

### Resource snapshot

- `resources/cyrene/prompts/source/system.md`: unchanged upstream system prompt for study only.
- `resources/cyrene/prompts/runtime-system.md`: capability-accurate Phase 6D runtime rules.
- `resources/cyrene/prompts/identity.md`: always-on identity.
- `resources/cyrene/prompts/soul.md`: always-on personality.
- `resources/cyrene/prompts/tone-rules.md`: always-on tone constraints.
- `resources/cyrene/prompts/styles/*.md`: five selectable style prompts.
- `resources/cyrene/knowledge/canon_quotes.md`: RAG source.
- `resources/cyrene/knowledge/worldbook/*.md`: RAG sources.
- `resources/cyrene/inactive-skills/cyrene-original-voice/**`: copied but never loaded.
- `resources/cyrene/ORIGIN.md`: provenance, inclusion map, and IP disclaimer.
- `resources/cyrene/LICENSE.upstream`: upstream MIT license copy.

### Persona modules

- `src/shared/persona-types.ts`: `StyleId`, labels, validation, IPC result types.
- `src/main/prompts/prompt-loader.ts`: strict UTF-8 prompt file loading.
- `src/main/prompts/prompt-composer.ts`: deterministic system prompt assembly.
- `src/main/config/persona-config.ts`: global style JSON load/save.
- `src/main/chat/chat-session.ts`: history-only session state and pending style transition.

### RAG modules

- `src/main/rag/markdown-knowledge-loader.ts`: heading-aware Markdown parsing and stable document IDs.
- `src/main/rag/cyrene-knowledge.ts`: load the selected corpus from resources.
- `src/main/rag/default-knowledge.ts`: build the production knowledge base from the Cyrene corpus.
- `scripts/rag-benchmark.ts`: cold/warm timing and Recall@K reporting.
- `tests/fixtures/rag-evaluation.ts`: fixed questions and expected document IDs.

### Electron and CLI integration

- `src/main/app/register-chat-ipc.ts`: dynamic prompt request assembly and style IPC handlers.
- `src/shared/ipc-channels.ts`: stable persona channels.
- `src/shared/electron-api.ts`: typed persona API.
- `src/preload/index.ts`: restricted `window.cyrene.persona` bridge.
- `src/renderer/chat/index.html`: accessible style selector.
- `src/renderer/chat/main.ts`: load and change style without clearing chat.
- `src/renderer/chat/style.css`: compact selector styling.
- `src/cli/chat.ts`: shared prompt composition and history-only CLI loop.

---

### Task 1: Import the Curated Upstream Resource Snapshot

**Files:**
- Create: `resources/cyrene/prompts/source/system.md`
- Create: `resources/cyrene/prompts/runtime-system.md`
- Create: `resources/cyrene/prompts/identity.md`
- Create: `resources/cyrene/prompts/soul.md`
- Create: `resources/cyrene/prompts/tone-rules.md`
- Create: `resources/cyrene/prompts/styles/01_default.md`
- Create: `resources/cyrene/prompts/styles/02_lively.md`
- Create: `resources/cyrene/prompts/styles/03_healing.md`
- Create: `resources/cyrene/prompts/styles/04_focused.md`
- Create: `resources/cyrene/prompts/styles/05_sweet.md`
- Create: `resources/cyrene/knowledge/canon_quotes.md`
- Create: `resources/cyrene/knowledge/worldbook/_glossary.md`
- Create: `resources/cyrene/knowledge/worldbook/Cyrene.md`
- Create: `resources/cyrene/knowledge/worldbook/characters.md`
- Create: `resources/cyrene/knowledge/worldbook/story.md`
- Create: `resources/cyrene/knowledge/worldbook/world.md`
- Create: `resources/cyrene/inactive-skills/cyrene-original-voice/**`
- Create: `resources/cyrene/ORIGIN.md`
- Create: `resources/cyrene/LICENSE.upstream`
- Test: `tests/resources/cyrene-resources.test.ts`

**Interfaces:**
- Consumes: selected files from `C:/Study/daydayup/projects/Cyrene-Agent`.
- Produces: a committed UTF-8 snapshot rooted at `resources/cyrene` with stable relative paths.

- [ ] **Step 1: Write the failing resource-manifest test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve("resources/cyrene");
const required = [
  "prompts/source/system.md",
  "prompts/runtime-system.md",
  "prompts/identity.md",
  "prompts/soul.md",
  "prompts/tone-rules.md",
  "prompts/styles/01_default.md",
  "prompts/styles/02_lively.md",
  "prompts/styles/03_healing.md",
  "prompts/styles/04_focused.md",
  "prompts/styles/05_sweet.md",
  "knowledge/canon_quotes.md",
  "knowledge/worldbook/_glossary.md",
  "knowledge/worldbook/Cyrene.md",
  "knowledge/worldbook/characters.md",
  "knowledge/worldbook/story.md",
  "knowledge/worldbook/world.md",
  "inactive-skills/cyrene-original-voice/SKILL.md",
  "ORIGIN.md",
  "LICENSE.upstream",
];

describe("Cyrene resource snapshot", () => {
  it.each(required)("contains non-empty UTF-8 resource %s", (relativePath) => {
    expect(readFileSync(resolve(root, relativePath), "utf8").trim().length).toBeGreaterThan(0);
  });

  it("does not import phone or talk prompts", () => {
    expect(() => readFileSync(resolve(root, "prompts/phone_system.md"), "utf8")).toThrow();
    expect(() => readFileSync(resolve(root, "prompts/talk_system.md"), "utf8")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/resources/cyrene-resources.test.ts`

Expected: FAIL with `ENOENT` for `resources/cyrene/...`.

- [ ] **Step 3: Copy the exact selected upstream files**

Run these PowerShell commands from the replica repository:

```powershell
$source = "C:\Study\daydayup\projects\Cyrene-Agent"
$target = "C:\Study\daydayup\projects\Cyrene-Agent-Replica-Lab\resources\cyrene"
New-Item -ItemType Directory -Force "$target\prompts\source", "$target\prompts\styles", "$target\knowledge\worldbook", "$target\inactive-skills" | Out-Null
Copy-Item "$source\prompts\system.md" "$target\prompts\source\system.md"
Copy-Item "$source\prompts\identity.md", "$source\prompts\soul.md", "$source\prompts\tone-rules.md" "$target\prompts"
Copy-Item "$source\prompts\styles\01_default.md", "$source\prompts\styles\02_lively.md", "$source\prompts\styles\03_healing.md", "$source\prompts\styles\04_focused.md", "$source\prompts\styles\05_sweet.md" "$target\prompts\styles"
Copy-Item "$source\prompts\canon_quotes.md" "$target\knowledge\canon_quotes.md"
Copy-Item "$source\prompts\worldbook\_glossary.md", "$source\prompts\worldbook\Cyrene.md", "$source\prompts\worldbook\characters.md", "$source\prompts\worldbook\story.md", "$source\prompts\worldbook\world.md" "$target\knowledge\worldbook"
Copy-Item "$source\skills\cyrene-original-voice" "$target\inactive-skills\cyrene-original-voice" -Recurse
Copy-Item "$source\LICENSE" "$target\LICENSE.upstream"
```

Create `runtime-system.md` with capability-accurate rules:

```markdown
# Cyrene Replica Lab Runtime Rules

You are the text-based Cyrene persona in Cyrene Agent Replica Lab.
Answer in the language used by the user unless the user requests another language.
Use only tools exposed in the current model request. Never claim that an unavailable tool was executed.
When a question depends on Cyrene lore or world knowledge, use `search_knowledge` before answering.
If retrieved evidence is missing or uncertain, say so instead of inventing canon facts.
Preserve relevant context from the current conversation.
Do not claim to remember conversations from before the current application session.
```

Create `ORIGIN.md` with this content:

```markdown
# Resource Origin

The text resources in this directory are a curated snapshot from the local upstream project at `C:\Study\daydayup\projects\Cyrene-Agent`, captured for Phase 6D retrieval and persona study.

Included runtime material: identity, soul, tone rules, five text styles, canon quotes, and five worldbook Markdown files. The upstream `system.md` is retained under `prompts/source/` for comparison; runtime behavior uses the capability-accurate `prompts/runtime-system.md` instead.

`inactive-skills/cyrene-original-voice` is reference material only. Phase 6D does not load, register, or execute it.

Upstream code and documentation are provided under the MIT license copied as `LICENSE.upstream`. Cyrene and the related Honkai: Star Rail names, characters, and world setting remain intellectual property of HoYoverse/miHoYo. This repository is a learning-oriented fan derivative and does not claim ownership or commercial rights over that underlying IP.
```

- [ ] **Step 4: Run the focused test and encoding sanity checks**

Run: `npx vitest run tests/resources/cyrene-resources.test.ts`

Expected: PASS.

Run: `rg -n "phone_|talk_system|TTS|ASR" resources/cyrene/prompts resources/cyrene/knowledge`

Expected: no imported phone/talk capability files; incidental prose matches must be manually checked and must not assert runtime voice capabilities.

- [ ] **Step 5: Commit**

```bash
git add resources/cyrene tests/resources/cyrene-resources.test.ts
git commit -m "feat: add curated Cyrene text resources"
```

### Task 2: Add Style Types and Strict Prompt Composition

**Files:**
- Create: `src/shared/persona-types.ts`
- Create: `src/main/prompts/prompt-loader.ts`
- Create: `src/main/prompts/prompt-composer.ts`
- Test: `tests/prompts/prompt-loader.test.ts`
- Test: `tests/prompts/prompt-composer.test.ts`

**Interfaces:**
- Consumes: resource paths from Task 1.
- Produces: `StyleId`, `STYLE_OPTIONS`, `isStyleId`, `loadRequiredPrompt`, `createPromptComposer`, and `composeSystemPrompt`.

- [ ] **Step 1: Write failing style and prompt tests**

Test these exact behaviors:

```ts
expect(isStyleId("healing")).toBe(true);
expect(isStyleId("phone")).toBe(false);
expect(STYLE_OPTIONS.map((option) => option.id)).toEqual([
  "default", "lively", "healing", "focused", "sweet",
]);
expect(() => loadRequiredPrompt("missing.md", fakeReader)).toThrow(
  "Required prompt file is missing or empty: missing.md",
);
```

Test deterministic composition with an in-memory reader:

```ts
const composer = createPromptComposer({
  readPrompt: (path) => ({
    "runtime-system.md": "SYSTEM",
    "identity.md": "IDENTITY",
    "soul.md": "SOUL",
    "tone-rules.md": "TONE",
    "styles/03_healing.md": "HEALING",
  })[path] ?? "",
});

expect(composer.composeSystemPrompt({ styleId: "healing" })).toBe(
  ["SYSTEM", "IDENTITY", "SOUL", "TONE", "HEALING"].join("\n\n---\n\n"),
);
```

Also assert that a transition is appended last and contains both Chinese labels.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/prompts/prompt-loader.test.ts tests/prompts/prompt-composer.test.ts`

Expected: FAIL because the three modules do not exist.

- [ ] **Step 3: Implement the shared style contract**

```ts
export const STYLE_OPTIONS = [
  { id: "default", label: "温柔和善", file: "01_default.md" },
  { id: "lively", label: "元气活泼", file: "02_lively.md" },
  { id: "healing", label: "治愈安心", file: "03_healing.md" },
  { id: "focused", label: "知性认真", file: "04_focused.md" },
  { id: "sweet", label: "撒娇黏人", file: "05_sweet.md" },
] as const;

export type StyleId = (typeof STYLE_OPTIONS)[number]["id"];

export function isStyleId(value: unknown): value is StyleId {
  return STYLE_OPTIONS.some((option) => option.id === value);
}

export function getStyleOption(styleId: StyleId) {
  return STYLE_OPTIONS.find((option) => option.id === styleId)!;
}
```

- [ ] **Step 4: Implement strict loading and composition**

`loadRequiredPrompt(relativePath, readPrompt)` trims text and throws the exact tested error when empty. `createPromptComposer({ resourceDir?, readPrompt? })` returns:

```ts
interface PromptComposer {
  composeSystemPrompt(input: {
    styleId: StyleId;
    transition?: { from: StyleId; to: StyleId };
  }): string;
}
```

The factory eagerly loads and validates the four core files and all five style files. This makes a missing persona asset a startup error instead of a delayed first-message failure. The transition text is merged into the final system string and is never returned as a standalone history message.

- [ ] **Step 5: Run focused and type tests**

Run: `npx vitest run tests/prompts/prompt-loader.test.ts tests/prompts/prompt-composer.test.ts && npm run typecheck`

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/persona-types.ts src/main/prompts tests/prompts
git commit -m "feat: compose Cyrene persona prompts"
```

### Task 3: Persist the Last Selected Style

**Files:**
- Create: `src/main/config/persona-config.ts`
- Test: `tests/config/persona-config.test.ts`

**Interfaces:**
- Consumes: `StyleId` and `isStyleId` from Task 2; `writeFileAtomically` from Phase 6C.
- Produces: `loadPersonaConfig`, `savePersonaConfig`, and `PersonaConfig`.

- [ ] **Step 1: Write failing config tests**

```ts
expect(await loadPersonaConfig(missingPath)).toEqual({ styleId: "default" });
expect(await loadPersonaConfig(validPath)).toEqual({ styleId: "healing" });
expect(await loadPersonaConfig(invalidPath, logger)).toEqual({ styleId: "default" });
expect(logger).toHaveBeenCalledWith(expect.stringContaining("invalid style"));

await savePersonaConfig(configPath, { styleId: "focused" });
expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
  schemaVersion: 1,
  styleId: "focused",
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/config/persona-config.test.ts`

Expected: FAIL because `persona-config.ts` does not exist.

- [ ] **Step 3: Implement versioned config loading and atomic saving**

```ts
export interface PersonaConfig {
  styleId: StyleId;
}

export async function loadPersonaConfig(
  filePath = defaultPersonaConfigPath(),
  logger: (message: string) => void = console.warn,
): Promise<PersonaConfig>;

export async function savePersonaConfig(
  filePath: string,
  config: PersonaConfig,
): Promise<void>;
```

Missing files silently return `default`; malformed JSON and invalid schema/style return `default` with a warning. Saving uses `writeFileAtomically` and emits formatted JSON ending in a newline.

`defaultPersonaConfigPath()` returns `join(homedir(), ".cyrene-agent-replica-lab", "persona.json")`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/config/persona-config.test.ts tests/rag/atomic-file-write.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/config/persona-config.ts tests/config/persona-config.test.ts
git commit -m "feat: persist persona style selection"
```

### Task 4: Refactor ChatSession to Own History and Style State

**Files:**
- Modify: `src/main/chat/chat-session.ts`
- Modify: `tests/main/chat-session.test.ts`

**Interfaces:**
- Consumes: `StyleId` from Task 2.
- Produces: a history-only `ChatSession` with `getStyle`, `setStyle`, `getPendingStyleTransition`, and `acknowledgeStyleTransition`.

- [ ] **Step 1: Replace existing expectations with failing state tests**

```ts
const session = createChatSession({ styleId: "default" });
session.appendUserMessage("remember this");
session.replaceMessages([
  { role: "user", content: "remember this" },
  { role: "assistant", content: "remembered" },
]);
session.setStyle("healing");

expect(session.getMessages()).toHaveLength(2);
expect(session.getStyle()).toBe("healing");
expect(session.getPendingStyleTransition()).toEqual({ from: "default", to: "healing" });
```

Add tests that:

- setting the same style creates no transition;
- `acknowledgeStyleTransition()` clears it;
- `clear()` clears messages but keeps the selected style;
- `replaceMessages()` rejects/removes a leading system message according to the final contract;
- all getters return defensive copies.

- [ ] **Step 2: Run the test and verify contract failures**

Run: `npx vitest run tests/main/chat-session.test.ts`

Expected: FAIL because the old constructor and interface include the system message.

- [ ] **Step 3: Implement the history-only session**

Use this public interface:

```ts
export interface ChatSession {
  getMessages(): ChatMessage[];
  appendUserMessage(text: string): ChatMessage[];
  replaceMessages(messages: ChatMessage[]): void;
  clear(): void;
  getStyle(): StyleId;
  setStyle(styleId: StyleId): void;
  getPendingStyleTransition(): StyleTransition | undefined;
  acknowledgeStyleTransition(): void;
}

export function createChatSession(input: { styleId: StyleId }): ChatSession;
```

Choose one strict policy and test it consistently: `replaceMessages` must throw if any `system` role enters session-owned history. IPC will strip the request system message before calling it.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/main/chat-session.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/chat-session.ts tests/main/chat-session.test.ts
git commit -m "refactor: separate chat history from persona prompt"
```

### Task 5: Parse Worldbook Markdown into Stable Knowledge Documents

**Files:**
- Create: `src/main/rag/markdown-knowledge-loader.ts`
- Create: `tests/rag/markdown-knowledge-loader.test.ts`

**Interfaces:**
- Consumes: `KnowledgeDocument` from `rag-types.ts`.
- Produces: `parseMarkdownKnowledge` and `loadMarkdownKnowledgeDirectory`.

- [ ] **Step 1: Write failing parser tests**

Use an inline fixture with an H1 preamble, two H2 sections, metadata bullets, and body text. Assert:

```ts
expect(parseMarkdownKnowledge({
  relativePath: "worldbook/Cyrene.md",
  markdown: "# Cyrene\nIntro\n\n## First Form\n- 触发词: core\n\nBody A\n\n## First Form\nBody B",
  collection: "cyrene-worldbook",
})).toEqual([
  expect.objectContaining({
    id: "worldbook_cyrene_first-form",
    title: "First Form",
    source: "worldbook/Cyrene.md",
    metadata: expect.objectContaining({ section: "First Form" }),
  }),
  expect.objectContaining({ id: "worldbook_cyrene_first-form-2" }),
]);
```

Add exact tests for glossary H2 sections, a heading-free Markdown file, ignored empty sections, CRLF input, and identical IDs across two parses.

- [ ] **Step 2: Run the parser test and verify it fails**

Run: `npx vitest run tests/rag/markdown-knowledge-loader.test.ts`

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement heading parsing and stable slugs**

```ts
export interface ParseMarkdownKnowledgeInput {
  relativePath: string;
  markdown: string;
  collection: string;
}

export function parseMarkdownKnowledge(
  input: ParseMarkdownKnowledgeInput,
): KnowledgeDocument[];

export function loadMarkdownKnowledgeDirectory(input: {
  directory: string;
  sourcePrefix: string;
  collection: string;
}): KnowledgeDocument[];
```

IDs are based only on normalized relative path, H2 title, and duplicate ordinal. Preserve the H2 title and full section text in `text`. Sort directory filenames before parsing so output order is deterministic.

- [ ] **Step 4: Run parser and existing chunk tests**

Run: `npx vitest run tests/rag/markdown-knowledge-loader.test.ts tests/rag/chunk-text.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/rag/markdown-knowledge-loader.ts tests/rag/markdown-knowledge-loader.test.ts
git commit -m "feat: parse worldbook markdown by section"
```

### Task 6: Load the Production Cyrene Corpus

**Files:**
- Create: `src/main/rag/cyrene-knowledge.ts`
- Modify: `src/main/rag/default-knowledge.ts`
- Modify: `src/main/tools/built-in-tools.ts`
- Create: `tests/rag/cyrene-knowledge.test.ts`
- Modify: `tests/tools/built-in-tools.test.ts`
- Modify: `tests/cli/chat.test.ts`

**Interfaces:**
- Consumes: Task 5 Markdown loader and existing `createKnowledgeBase`.
- Produces: `loadCyreneKnowledgeDocuments` and resource-root injection through default knowledge/tool factories.

- [ ] **Step 1: Write failing corpus tests**

```ts
const documents = loadCyreneKnowledgeDocuments(resolve("resources/cyrene/knowledge"));
expect(documents.length).toBeGreaterThan(10);
expect(documents.some((doc) => doc.source === "worldbook/Cyrene.md")).toBe(true);
expect(documents.some((doc) => doc.source === "canon_quotes.md")).toBe(true);
expect(documents.every((doc) => doc.metadata?.collection === "cyrene-worldbook")).toBe(true);
expect(documents.some((doc) => doc.source === "seed")).toBe(false);
```

Update built-in tool tests to inject a temporary resource root rather than depending on the three removed runtime seed documents.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npx vitest run tests/rag/cyrene-knowledge.test.ts tests/tools/built-in-tools.test.ts tests/cli/chat.test.ts`

Expected: FAIL because production still uses `DEFAULT_DOCUMENTS`.

- [ ] **Step 3: Implement the corpus loader**

```ts
export function loadCyreneKnowledgeDocuments(
  knowledgeDir = resolve(process.cwd(), "resources/cyrene/knowledge"),
): KnowledgeDocument[];
```

Load `worldbook/*.md` with collection `cyrene-worldbook`. Parse `canon_quotes.md` with the same collection and source `canon_quotes.md`. Throw ``Cyrene knowledge corpus is empty: ${knowledgeDir}`` when no documents are produced.

- [ ] **Step 4: Replace runtime seed documents**

Add `knowledgeDir?: string` to `CreateDefaultKnowledgeBaseOptions` and `CreateDefaultToolRegistryOptions`. Pass loaded Cyrene documents to `createKnowledgeBase`. Move the three old seed objects into the relevant tests as fixtures; do not leave them in production defaults.

- [ ] **Step 5: Run RAG and tool tests**

Run: `npx vitest run tests/rag tests/tools/built-in-tools.test.ts tests/cli/chat.test.ts`

Expected: PASS without calling a real Ollama server because tests inject fake providers/indexes or avoid search.

- [ ] **Step 6: Commit**

```bash
git add src/main/rag/cyrene-knowledge.ts src/main/rag/default-knowledge.ts src/main/tools/built-in-tools.ts tests/rag tests/tools/built-in-tools.test.ts tests/cli/chat.test.ts
git commit -m "feat: use Cyrene worldbook as runtime knowledge"
```

### Task 7: Assemble Dynamic Persona Requests in Main IPC

**Files:**
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`

**Interfaces:**
- Consumes: Prompt Composer, Persona Config, and history-only ChatSession.
- Produces: dynamic request assembly plus style get/set IPC handlers.

- [ ] **Step 1: Rewrite IPC test dependencies**

Replace `createInitialHistory` injection with:

```ts
createPromptComposer: () => ({
  composeSystemPrompt: vi.fn(({ styleId, transition }) =>
    `system:${styleId}:${transition ? `${transition.from}->${transition.to}` : "steady"}`,
  ),
}),
loadPersonaConfig: async () => ({ styleId: "default" }),
savePersonaConfig: vi.fn(async () => undefined),
```

Use these dependency signatures so Main IPC does not need to know the config file path:

```ts
loadPersonaConfig?: () => Promise<PersonaConfig>;
savePersonaConfig?: (config: PersonaConfig) => Promise<void>;
createPromptComposer?: () => PromptComposer;
```

The production defaults wrap Task 3's path-aware functions. Tests inject the zero-argument loader and one-argument saver shown above.

Because registration must await style loading, change the API to:

```ts
export async function registerChatIpc(deps: RegisterChatIpcDeps): Promise<void>;
```

- [ ] **Step 2: Add failing behavior tests**

Assert all of these:

- first model request is `[dynamic system, user]`;
- second request has one fresh system message and preserved non-system history;
- `setStyle("healing")` keeps history and saves config;
- the next request system contains `default->healing`;
- a successful request clears the transition;
- a rejected request retains the transition for retry;
- unknown style IDs reject before changing session state;
- a config-save failure leaves the current session style unchanged;
- clear-session returns `messageCount: 0` and keeps style;
- result `messageCount` counts persisted history only, not the transient system message.

- [ ] **Step 3: Run the IPC test and verify it fails**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts`

Expected: FAIL against the old static-history implementation.

- [ ] **Step 4: Implement request assembly and result normalization**

For each send:

```ts
const history = session.appendUserMessage(text);
const systemMessage: ChatMessage = {
  role: "system",
  content: promptComposer.composeSystemPrompt({
    styleId: session.getStyle(),
    transition: session.getPendingStyleTransition(),
  }),
};
const result = await runAgent({ messages: [systemMessage, ...history], ... });
const persistedMessages = result.messages.filter((message) => message.role !== "system");
session.replaceMessages(persistedMessages);
session.acknowledgeStyleTransition();
```

Do not acknowledge the transition in a `finally` block; failures must preserve it.

- [ ] **Step 5: Register style handlers and update Electron boot**

Register `IPC_CHANNELS.persona.getStyle` and `IPC_CHANNELS.persona.setStyle`. Update `src/main/app/main.ts` to await `registerChatIpc({ ipcMain })` after `app.whenReady()` and before opening the window, so persisted style is loaded deterministically.

The set-style handler validates the ID, persists `{ styleId }`, and only then calls `session.setStyle(styleId)`. A persistence failure therefore returns an IPC error without changing in-memory state.

- [ ] **Step 6: Run IPC and agent tests**

Run: `npx vitest run tests/main/register-chat-ipc.test.ts tests/main/chat-session.test.ts tests/agent/tool-agent.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/app/register-chat-ipc.ts src/main/app/main.ts tests/main/register-chat-ipc.test.ts
git commit -m "feat: switch persona styles without losing chat history"
```

### Task 8: Expose a Typed, Restricted Persona API through Preload

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/electron-api.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/shared/ipc-channels.test.ts`
- Create: `tests/shared/electron-api.test.ts`

**Interfaces:**
- Consumes: `StyleId` from Task 2.
- Produces: `window.cyrene.persona.getStyle()` and `setStyle(styleId)`.

- [ ] **Step 1: Write failing shared contract tests**

```ts
expect(IPC_CHANNELS.persona.getStyle).toBe("cyrene:persona:get-style");
expect(IPC_CHANNELS.persona.setStyle).toBe("cyrene:persona:set-style");

const styleResult: PersonaStyleResult = { styleId: "healing" };
expect(styleResult.styleId).toBe("healing");
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npx vitest run tests/shared/ipc-channels.test.ts tests/shared/electron-api.test.ts`

Expected: FAIL because persona channels/types do not exist.

- [ ] **Step 3: Add shared types and preload bridge**

Extend `CyreneApi` exactly as follows:

```ts
persona: {
  getStyle: () => Promise<{ styleId: StyleId }>;
  setStyle: (styleId: StyleId) => Promise<{ styleId: StyleId }>;
};
```

Preload delegates only to the two constant IPC channels. It does not expose raw `ipcRenderer`, arbitrary channel names, file paths, or prompt file contents.

- [ ] **Step 4: Run typecheck and shared tests**

Run: `npx vitest run tests/shared && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared src/preload/index.ts tests/shared
git commit -m "feat: expose typed persona style API"
```

### Task 9: Add the Renderer Style Selector

**Files:**
- Create: `src/renderer/chat/style-selector.ts`
- Modify: `src/renderer/chat/main.ts`
- Modify: `src/renderer/chat/index.html`
- Modify: `src/renderer/chat/style.css`
- Create: `tests/renderer/style-selector.test.ts`
- Modify: `tests/renderer/vite-renderer-config.test.ts`

**Interfaces:**
- Consumes: `STYLE_OPTIONS` and `window.cyrene.persona`.
- Produces: a compact select control that loads current style and changes it without clearing messages.

- [ ] **Step 1: Write failing selector logic tests without a browser DOM**

Keep testable state logic in `style-selector.ts`:

```ts
export async function loadSelectedStyle(api: CyreneApi["persona"]): Promise<StyleId> {
  return (await api.getStyle()).styleId;
}

export async function changeSelectedStyle(
  api: CyreneApi["persona"],
  styleId: StyleId,
): Promise<StyleId> {
  return (await api.setStyle(styleId)).styleId;
}
```

Assert the exact API calls and returned IDs with Vitest fakes.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/renderer/style-selector.test.ts`

Expected: FAIL because `style-selector.ts` does not exist.

- [ ] **Step 3: Implement the selector markup and wiring**

Add a labeled `<select id="style-select">` in the topbar. Populate options from `STYLE_OPTIONS`, load the saved style on startup, call `setStyle` on `change`, and restore the prior selected value if IPC rejects.

Do not call `clearSession`, `clearChatView`, or remove message nodes during style changes.

- [ ] **Step 4: Add compact responsive styles**

Use existing topbar visual conventions, fixed minimum control height, visible focus state, and wrapping at narrow widths. Do not introduce a card, hero, gradient, or decorative imagery in this operational learning UI.

- [ ] **Step 5: Run renderer tests and production build**

Run: `npx vitest run tests/renderer && npm run build:renderer`

Expected: tests PASS and Vite emits `dist/renderer/chat/index.html` plus CSS/JS assets.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/chat tests/renderer
git commit -m "feat: add chat persona style selector"
```

### Task 10: Make the CLI Use the Shared Dynamic Persona

**Files:**
- Modify: `src/cli/chat.ts`
- Modify: `tests/cli/chat.test.ts`

**Interfaces:**
- Consumes: Prompt Composer and history-only message contract.
- Produces: `createRuntimePromptComposer` and CLI requests identical to Electron's steady-style prompt.

- [ ] **Step 1: Write failing CLI prompt tests**

Remove expectations for the old English `SYSTEM_PROMPT`. Assert:

```ts
const prompt = createRuntimePromptComposer().composeSystemPrompt({ styleId: "default" });
expect(prompt).toContain("昔涟");
expect(prompt).toContain("风格：温柔");
expect(prompt).not.toContain("phone_system");
expect(prompt).not.toContain("search_knowledge rather than a keyword list");
```

Add a pure helper test for:

```ts
expect(buildModelMessages(prompt, [{ role: "user", content: "hello" }])).toEqual([
  { role: "system", content: prompt },
  { role: "user", content: "hello" },
]);
```

- [ ] **Step 2: Run the CLI tests and verify they fail**

Run: `npx vitest run tests/cli/chat.test.ts`

Expected: FAIL because CLI still exports the static minimal prompt.

- [ ] **Step 3: Refactor the CLI loop**

Keep `history` free of system messages. Load the persisted global style once at CLI startup, compose a fresh system prompt for each user turn, pass `[system, ...history]` to `runToolAgent`, then strip the first system message from `result.messages` before assigning `history`.

Do not add interactive CLI style commands in Phase 6D; the Electron selector owns style changes, while CLI uses the persisted last style.

- [ ] **Step 4: Run CLI and IPC tests**

Run: `npx vitest run tests/cli/chat.test.ts tests/main/register-chat-ipc.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/chat.ts tests/cli/chat.test.ts
git commit -m "refactor: share persona prompts with CLI chat"
```

### Task 11: Add Cold/Warm RAG Benchmarking and Recall Evaluation

**Files:**
- Create: `src/cli/rag-benchmark.ts`
- Create: `tests/fixtures/rag-evaluation.ts`
- Create: `tests/cli/rag-benchmark.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadCyreneKnowledgeDocuments`, `chunkDocument`, Ollama embedding config, and JSON vector index.
- Produces: `runRagBenchmark`, `calculateRecallAtK`, and `npm run rag:benchmark`.

- [ ] **Step 1: Write failing metric tests**

```ts
expect(calculateRecallAtK([
  { expectedDocumentId: "a", returnedDocumentIds: ["b", "a", "c"] },
  { expectedDocumentId: "x", returnedDocumentIds: ["x", "y"] },
], 1)).toBe(0.5);

expect(calculateRecallAtK([
  { expectedDocumentId: "a", returnedDocumentIds: ["b", "a", "c"] },
  { expectedDocumentId: "x", returnedDocumentIds: ["x", "y"] },
], 3)).toBe(1);
```

Test output formatting with fake timings and fake retrieval results; unit tests must not require Ollama.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npx vitest run tests/cli/rag-benchmark.test.ts`

Expected: FAIL because the benchmark module does not exist.

- [ ] **Step 3: Define the fixed evaluation cases**

Create at least the six approved Chinese questions. Each case contains:

```ts
export interface RagEvaluationCase {
  question: string;
  expectedDocumentIds: string[];
}
```

Derive expected IDs by running the deterministic Markdown parser, then record exact IDs in the fixture. Allow multiple acceptable IDs where one question is genuinely answered by multiple sections.

- [ ] **Step 4: Implement benchmark phases**

`runRagBenchmark` must report:

```ts
interface RagBenchmarkReport {
  markdownFileCount: number;
  documentCount: number;
  chunkCount: number;
  vectorDimensions: number;
  indexBytes: number;
  coldBuildMs: number;
  warmLoadMs: number;
  averageQueryMs: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
}
```

Use a temporary benchmark index path by default so the command can deliberately measure cold and warm runs without deleting the user's normal index. Remove only the temporary benchmark directory in a `finally` block.

- [ ] **Step 5: Add the npm script and run unit tests**

Add:

```json
"rag:benchmark": "tsx src/cli/rag-benchmark.ts"
```

Run: `npx vitest run tests/cli/rag-benchmark.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Run the real Ollama benchmark**

Precondition: `ollama list` shows `qwen3-embedding:4b` and Ollama is listening on the configured base URL.

Run: `npm run rag:benchmark`

Expected: prints all required counts/timings and Recall@1/3/5, creates and reloads a temporary index, then removes the temporary benchmark directory.

- [ ] **Step 7: Commit**

```bash
git add src/cli/rag-benchmark.ts tests/fixtures/rag-evaluation.ts tests/cli/rag-benchmark.test.ts package.json
git commit -m "feat: benchmark worldbook vector retrieval"
```

### Task 12: Write the Chinese Learning Guide and Perform Full Verification

**Files:**
- Create: `docs/learning/phase-06d-persona-style-worldbook.zh-CN.md`
- Modify only if verification finds a Phase 6D regression: files already listed in Tasks 1-11.

**Interfaces:**
- Consumes: all completed Phase 6D modules.
- Produces: a beginner-readable explanation and verified release state.

- [ ] **Step 1: Write the Chinese learning document**

Explain with code references and a complete data-flow diagram:

```text
用户选择风格
  -> Renderer
  -> Preload
  -> IPC Main
  -> ChatSession.activeStyle
  -> Prompt Composer
  -> Agent Loop
```

Also explain:

- why system messages are no longer stored in history;
- why style transitions are request-only;
- why persona files stay in the prompt while worldbook files use RAG;
- how H2 Markdown sections become documents, chunks, vectors, and results;
- cold build versus warm index load;
- how to run automated tests, Electron manual tests, and the benchmark;
- what is intentionally postponed, especially voice/call and DMAE.

- [ ] **Step 2: Run the complete automated verification suite**

Run: `npm test`

Expected: all Vitest files and tests PASS.

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run build`

Expected: Electron TypeScript build and Vite renderer build both succeed.

- [ ] **Step 3: Run real service smoke tests**

Run: `npm run test:embedding`

Expected: Ollama returns a non-empty vector from `qwen3-embedding:4b`.

Run: `npm run rag:benchmark`

Expected: full benchmark report with finite timings and Recall@K values between 0 and 1.

- [ ] **Step 4: Perform Electron manual acceptance**

Run: `npm run dev:electron`

Verify:

1. saved style is selected at startup;
2. two normal turns preserve context;
3. changing to healing keeps visible messages;
4. the next answer changes style but remembers the topic;
5. a later answer does not receive the transition reminder again;
6. a lore question causes `search_knowledge` events with worldbook sources;
7. New Chat clears visible/history messages but keeps selected style;
8. restarting restores style and loads the existing vector index;
9. no microphone, voice, TTS, call, or Live2D controls appear.

- [ ] **Step 5: Inspect repository scope and encoding**

Run: `git status --short`

Expected: only the learning document and intentional Phase 6D fixes are uncommitted.

Run: `git diff --check`

Expected: no whitespace errors.

Run: `rg -n "phone_system|phone_identity|phone_style|talk_system|TTS|ASR" src resources/cyrene/prompts resources/cyrene/knowledge`

Expected: no active Phase 6D imports or runtime wiring for excluded voice/call features.

- [ ] **Step 6: Commit the learning guide and final verified fixes**

If verification reveals a regression, return to the owning task, add a failing regression test, fix it, rerun that task's checks, and commit the fix with that task before continuing. When verification is clean, commit the learning guide:

```bash
git add docs/learning/phase-06d-persona-style-worldbook.zh-CN.md
git commit -m "docs: explain phase 6d persona and worldbook"
```

## Final Acceptance Evidence

Record these concrete results in the execution summary:

- total Vitest file and test counts;
- `typecheck` result;
- Electron and Renderer build result;
- real Ollama embedding model and vector dimensions;
- corpus document/chunk counts;
- cold build time, warm load time, index size, average query time;
- Recall@1, Recall@3, Recall@5;
- manual style-switch and history-preservation result;
- confirmation that no voice/call functionality was added;
- final commit hashes;
- whether the branch was pushed (do not push unless the user explicitly requests it).
