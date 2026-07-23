# Currency War Prompt and Game Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为货币战争对局生成唯一的默认名称、简化对局下拉显示，并将 Agent 的核心系统提示词改为 4.4 版本标准博弈最高难度辅助教练。

**Architecture:** 对局名称由主进程 `CurrencyWarGameService` 统一生成，Renderer 只负责显示服务返回的名称。`PromptComposer` 改为加载一份独立的货币战争核心 Prompt，再追加现有风格 Prompt 和可选的一次性风格切换提醒；旧 Cyrene 核心资源保留但不再自动注入。

**Tech Stack:** TypeScript、Electron、Vitest、Node.js 文件资源加载。

## Global Constraints

- 只支持项目资料对应的 4.4 版本。
- 只讨论标准博弈，默认最高难度，不混入超频博弈。
- 对局总数上限保持 10。
- 不迁移或自动重命名已有对局。
- 用户手动名称允许重复；自动名称使用最小可用的 `对局 N`。
- 不改变 GameState 数据结构、RAG 算法、工具协议、记忆系统和对局与聊天的独立关系。
- 旧 Cyrene Prompt 资源暂时保留。

---

## File Structure

- Create: `resources/currency-war/prompts/system.md`
  - 保存货币战争 Agent 稳定、全局有效的核心身份、范围、行为和输出规则。
- Modify: `src/main/currency-war/games/currency-war-game-service.ts`
  - 在服务层生成唯一默认对局名。
- Modify: `src/renderer/chat/currency-war-games-view.ts`
  - 下拉框只显示对局名称。
- Modify: `src/main/prompts/prompt-composer.ts`
  - 默认加载货币战争核心 Prompt，并继续加载现有风格 Prompt。
- Modify: `tests/currency-war/games/currency-war-game-service.test.ts`
  - 验证默认名称、编号空缺和自定义名称行为。
- Modify: `tests/renderer/currency-war-games-view.test.ts`
  - 验证下拉文本不再拼接节点。
- Modify: `tests/prompts/prompt-composer.test.ts`
  - 验证新 Prompt 组成顺序和旧核心 Prompt 不再加载。

---

### Task 1: Unique Default Game Names

**Files:**
- Modify: `tests/currency-war/games/currency-war-game-service.test.ts`
- Modify: `src/main/currency-war/games/currency-war-game-service.ts`

**Interfaces:**
- Consumes: `CurrencyWarGameStore.list(): Promise<CurrencyWarGameSummary[]>`
- Produces: `nextDefaultGameName(games: Array<{ name: string }>): string`
- Preserves: `CurrencyWarGameService.create(name?: string): Promise<CurrencyWarGameState>`

- [ ] **Step 1: Write failing service tests**

Add tests that assert:

```ts
it("assigns the smallest unused default game number", async () => {
  let id = 0;
  const service = createCurrencyWarGameService({
    store: memoryStore(),
    catalog,
    idFactory: () => `game-${++id}`,
  });

  const first = (await service.initialize()).games[0];
  expect(first.name).toBe("对局 1");
  expect((await service.create()).name).toBe("对局 2");
  const third = await service.create();
  expect(third.name).toBe("对局 3");

  await service.remove((await service.list()).games
    .find((game) => game.name === "对局 2")!.gameId);
  expect((await service.create()).name).toBe("对局 2");
});

it("does not reserve automatic numbers for custom names", async () => {
  const service = createCurrencyWarGameService({
    store: memoryStore(),
    catalog,
  });
  await service.initialize();

  expect((await service.create("追击队")).name).toBe("追击队");
  expect((await service.create()).name).toBe("对局 2");
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
npx vitest run tests/currency-war/games/currency-war-game-service.test.ts
```

Expected: FAIL because the existing default name is `新对局`.

- [ ] **Step 3: Implement service-owned default naming**

Change `create` so it distinguishes omitted names from explicit names:

```ts
const create = async (name?: string) => {
  const games = await options.store.list();
  if (games.length >= MAX_CURRENCY_WAR_GAMES) {
    throw new Error("CURRENCY_WAR_GAME_LIMIT_REACHED");
  }
  const resolvedName = name === undefined
    ? nextDefaultGameName(games)
    : normalizeName(name);
  const state = createDefaultGameState(idFactory(), resolvedName, now());
  await options.store.save(state);
  await options.store.setActive(state.gameId);
  return structuredClone(state);
};
```

Add the focused helper:

```ts
function nextDefaultGameName(games: Array<{ name: string }>): string {
  const used = new Set<number>();
  for (const game of games) {
    const match = /^对局 ([1-9]\d*)$/.exec(game.name);
    if (match) used.add(Number(match[1]));
  }
  let number = 1;
  while (used.has(number)) number += 1;
  return `对局 ${number}`;
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
npx vitest run tests/currency-war/games/currency-war-game-service.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the naming change**

```powershell
git add src/main/currency-war/games/currency-war-game-service.ts tests/currency-war/games/currency-war-game-service.test.ts
git commit -m "feat: assign unique currency war game names"
```

---

### Task 2: Show Only the Game Name in the Selector

**Files:**
- Modify: `tests/renderer/currency-war-games-view.test.ts`
- Modify: `src/renderer/chat/currency-war-games-view.ts`

**Interfaces:**
- Consumes: `CurrencyWarGameSummary.name`
- Produces: `<option>.textContent === game.name`

- [ ] **Step 1: Write the failing renderer source test**

Add:

```ts
it("shows only the game name in the selector", async () => {
  const source = await readFile(
    new URL("../../src/renderer/chat/currency-war-games-view.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain("item.textContent = game.name");
  expect(source).not.toContain("${game.name} · ${game.nodeId}");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npx vitest run tests/renderer/currency-war-games-view.test.ts
```

Expected: FAIL because the selector currently renders `name · nodeId`.

- [ ] **Step 3: Simplify the option text**

Replace:

```ts
item.textContent = `${game.name} · ${game.nodeId}`;
```

with:

```ts
item.textContent = game.name;
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npx vitest run tests/renderer/currency-war-games-view.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the selector change**

```powershell
git add src/renderer/chat/currency-war-games-view.ts tests/renderer/currency-war-games-view.test.ts
git commit -m "fix: simplify currency war game selector labels"
```

---

### Task 3: Currency War System Prompt

**Files:**
- Create: `resources/currency-war/prompts/system.md`
- Modify: `tests/prompts/prompt-composer.test.ts`
- Modify: `src/main/prompts/prompt-composer.ts`

**Interfaces:**
- Produces: `defaultCurrencyWarPromptDir(): string`
- Preserves: `defaultCyrenePromptDir(): string`
- Preserves: `PromptComposer.composeSystemPrompt({ styleId, transition? }): string`
- Changes injected reader paths to: `system.md` and `styles/<style-file>`

- [ ] **Step 1: Rewrite the test prompt fixture and expectations**

Use this fixture shape:

```ts
const prompts: Record<string, string> = {
  "system.md": "CURRENCY_WAR_SYSTEM",
  "styles/01_default.md": "DEFAULT",
  "styles/02_lively.md": "LIVELY",
  "styles/03_healing.md": "HEALING",
  "styles/04_focused.md": "FOCUSED",
  "styles/05_sweet.md": "SWEET",
};
```

Change the composition assertion to:

```ts
expect(readPrompt).toHaveBeenCalledTimes(6);
expect(readPrompt).not.toHaveBeenCalledWith("identity.md");
expect(readPrompt).not.toHaveBeenCalledWith("soul.md");
expect(readPrompt).not.toHaveBeenCalledWith("tone-rules.md");
expect(composer.composeSystemPrompt({ styleId: "healing" })).toBe(
  ["CURRENCY_WAR_SYSTEM", "HEALING"].join("\n\n---\n\n"),
);
```

Add a missing-core-resource assertion:

```ts
expect(() => createPromptComposer({
  readPrompt: (path) => path === "system.md" ? "" : (prompts[path] ?? ""),
})).toThrow("Required prompt file is missing or empty: system.md");
```

- [ ] **Step 2: Run the focused Prompt tests and verify failure**

Run:

```powershell
npx vitest run tests/prompts/prompt-composer.test.ts
```

Expected: FAIL because the composer still requests four old core files.

- [ ] **Step 3: Add the currency-war prompt resource**

Create `resources/currency-war/prompts/system.md` with these complete sections:

```md
# 身份

你是《崩坏：星穹铁道》“货币战争”的对局决策辅助教练。你的首要目标是帮助玩家在当前项目资料对应的 4.4 版本中完成标准博弈最高难度，并解释建议背后的运营逻辑。保持轻量、自然的 Cyrene 语气，但不要让角色扮演妨碍准确性、可执行性或信息密度。

# 范围

- 只分析标准博弈，默认最高难度。
- 不得混入超频博弈的机制、节奏或数值。
- 超出资料范围或版本不确定时，明确说明，不得编造。
- 你只能提供建议，不能声称已经替用户修改对局状态。

# 输入检查

收到用户粘贴的对局总结后，检查当前节点、生命值、等级、经验、货币、投资环境、投资策略、上阵与后台角色、备战席、商店、装备、羁绊和已解锁顾问。只指出会显著改变决策的缺失信息；信息不足时给出带条件的建议。

# 证据与工具

区分硬规则、结构化事实、攻略经验和策略推断，不得把推断说成固定规则。涉及具体角色、装备、羁绊、顾问、投资环境或投资策略时，优先使用可用的知识检索工具。工具不可用或证据不足时，降低结论确定性，并说明缺少什么依据。不得虚构刷新成本、伤害公式、概率、角色效果或装备效果。

# 固定节点

第一位面依次为：1-1 奖励、1-2 奖励、选择投资策略、1-3 战斗、1-4 战斗、1-5 补给、1-6 战斗、1-7 遭遇、1-8 奖励、1-9 首领。

第二位面依次为：2-1 战斗、选择投资策略、2-2 战斗、2-3 补给、2-4 战斗、2-5 遭遇、2-6 奖励、2-7 首领。

第三位面与第二位面的节点类型分布相同。不得建议已经错过的选择，也不得把固定节点顺序说成随机流程。

# 回答方法

用户请求对局建议时，默认依次给出：

1. 当前判断：局面强弱、核心问题和路线判断。
2. 现在怎么做：按优先级给出本节点可执行操作。
3. 为什么：解释战力、经济、资源或阵容依据。
4. 备选方案：商店、奖励或资源结果不理想时如何调整。
5. 后续规划：规划接下来 1 至 3 个节点。
6. 风险与缺失信息：只列会改变决策的重要内容。

简单事实问题可以直接回答，不必机械套用完整结构。表达风格只能改变措辞和亲和程度，不能覆盖本提示词中的范围、事实、工具和输出要求。
```

- [ ] **Step 4: Change the composer to load one new core file**

Add:

```ts
export function defaultCurrencyWarPromptDir(): string {
  return fileURLToPath(
    new URL("../../../resources/currency-war/prompts/", import.meta.url),
  );
}
```

Retain `defaultCyrenePromptDir()` for style resources. For default construction, create one reader for `resources/currency-war/prompts` and one for `resources/cyrene/prompts`, then route logical paths:

```ts
const readPrompt = options.readPrompt ?? ((path: string) => {
  if (path.startsWith("styles/")) return styleReader(path);
  return systemReader(path);
});
const core = loadRequiredPrompt("system.md", readPrompt);
```

Compose with:

```ts
const parts = [core, styles.get(styleId)!];
```

The existing transition builder remains unchanged and is appended after the active style only when `transition` exists.

- [ ] **Step 5: Run focused Prompt tests**

Run:

```powershell
npx vitest run tests/prompts/prompt-composer.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 6: Verify the real resource composition**

Run:

```powershell
npx tsx -e "import { createPromptComposer } from './src/main/prompts/prompt-composer.ts'; const p=createPromptComposer().composeSystemPrompt({styleId:'default'}); console.log(p.includes('货币战争'), p.includes('标准博弈'), p.includes('超频博弈'));"
```

Expected:

```text
true true true
```

- [ ] **Step 7: Commit the Prompt change**

```powershell
git add resources/currency-war/prompts/system.md src/main/prompts/prompt-composer.ts tests/prompts/prompt-composer.test.ts
git commit -m "feat: add currency war coaching prompt"
```

---

### Task 4: Full Verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Verifies all deliverables from Tasks 1–3 together.

- [ ] **Step 1: Run TypeScript checks**

```powershell
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run all unit tests**

```powershell
npm test
```

Expected: all test files and tests PASS.

- [ ] **Step 3: Build Electron and Renderer**

```powershell
npm run build
```

Expected: Electron TypeScript compilation and Vite renderer build both complete successfully.

- [ ] **Step 4: Inspect repository state**

```powershell
git status --short --branch
git log -5 --oneline
```

Expected: no uncommitted implementation files; `main` contains the three implementation commits after the design and plan commits.

- [ ] **Step 5: Push only after all checks pass**

```powershell
git push origin main
```

Expected: local `main` successfully updates GitHub `main`. If the network fails, report the exact failure and keep the verified local commits intact.
