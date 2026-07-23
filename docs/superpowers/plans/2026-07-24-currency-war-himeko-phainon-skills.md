# Currency War Himeko and Phainon Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增姬子·启行—列车同行和白厄—以牙还牙甲两个阵容 Skill，并将货币战争 Agent 的适用范围统一修正为 4.4–4.7 内容周期。

**Architecture:** 两个新 Skill 沿用渐进加载结构，主文件负责触发和决策流程，阵容、运营、装备、证据拆成四份 Reference。现有 System Prompt 和卡芙卡—海瑟音 Skill 只修正版本语义，不改变策略内容或 `data/currency-war/runtime/4.4` 目录。

**Tech Stack:** Markdown、YAML frontmatter、TypeScript、Vitest、项目现有 SkillRegistry。

## Global Constraints

- 适用范围固定为 4.4–4.7、标准博弈、默认最高难度。
- 当前结构化数据基线仍来自 `data/currency-war/runtime/4.4/`，不重命名目录。
- 新 Skill ID 分别为 `currency-war-himeko-departure-train` 和 `currency-war-phainon-counter-armor`。
- 新 Skill 均为 `defaultEnabled: true`、`tools: []`。
- 每个 Skill 恰好包含 `lineup-core.md`、`operations.md`、`equipment.md`、`evidence.md` 四份 Reference。
- 不新增货币战争 RAG、专用工具、GameState 字段或其他阵容。
- 验证通过后删除两份根目录原稿。

---

## File Structure

- Modify: `resources/currency-war/prompts/system.md`
- Modify: `resources/skills/currency-war-kafka-hysilens-dot/SKILL.md`
- Modify: `resources/skills/currency-war-kafka-hysilens-dot/references/lineup-core.md`
- Modify: `resources/skills/currency-war-kafka-hysilens-dot/references/evidence.md`
- Create: `resources/skills/currency-war-himeko-departure-train/SKILL.md`
- Create: `resources/skills/currency-war-himeko-departure-train/references/{lineup-core,operations,equipment,evidence}.md`
- Create: `resources/skills/currency-war-phainon-counter-armor/SKILL.md`
- Create: `resources/skills/currency-war-phainon-counter-armor/references/{lineup-core,operations,equipment,evidence}.md`
- Modify: `tests/prompts/prompt-composer.test.ts`
- Modify: `tests/resources/skills-resources.test.ts`
- Delete: `CURRENCY_WAR_4_4_HIMEKO_DEPARTURE_LINEUP_SKILL.md`
- Delete: `CURRENCY_WAR_4_4_PHAINON_COUNTER_LINEUP_SKILL.md`

---

### Task 1: Correct the 4.4–4.7 Content-Cycle Scope

**Files:**
- Modify: `tests/prompts/prompt-composer.test.ts`
- Modify: `tests/resources/skills-resources.test.ts`
- Modify: `resources/currency-war/prompts/system.md`
- Modify: `resources/skills/currency-war-kafka-hysilens-dot/SKILL.md`
- Modify: `resources/skills/currency-war-kafka-hysilens-dot/references/lineup-core.md`
- Modify: `resources/skills/currency-war-kafka-hysilens-dot/references/evidence.md`

**Interfaces:**
- Preserves: `PromptComposer.composeSystemPrompt(...)`
- Preserves: Skill ID `currency-war-kafka-hysilens-dot`
- Produces: content-cycle label `4.4–4.7`
- Produces: evidence labels `cycle-confirmed` and `lineup-synthesis`

- [ ] **Step 1: Add failing scope tests**

In `tests/prompts/prompt-composer.test.ts`, add:

```ts
it("uses the 4.4–4.7 currency war content cycle in the real system prompt", () => {
  const prompt = createPromptComposer().composeSystemPrompt({ styleId: "default" });
  expect(prompt).toContain("4.4–4.7");
  expect(prompt).toContain("结构化数据基线来自 4.4");
  expect(prompt).not.toContain("只分析 4.4");
});
```

In the existing Kafka Hysilens resource test, add:

```ts
expect(body).toContain("4.4–4.7");
expect(body).not.toContain("只处理 4.4 版本");
expect(evidence).toContain("cycle-confirmed");
expect(evidence).toContain("lineup-synthesis");
expect(evidence).not.toContain("4.4-synthesis");
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
npx.cmd vitest run tests/prompts/prompt-composer.test.ts tests/resources/skills-resources.test.ts
```

Expected: FAIL because the current Prompt and DoT Skill still use 4.4-only wording.

- [ ] **Step 3: Update the System Prompt**

Change the identity and scope to state:

```md
你是《崩坏：星穹铁道》“货币战争”的对局决策辅助教练。当前玩法适用于从 4.4 开始、持续至 4.7 的同一内容周期，项目结构化数据基线来自 4.4。

- 只分析 4.4–4.7 内容周期内的标准博弈，默认最高难度。
- 不得混入超频博弈的机制、节奏或数值。
- 用户询问周期外版本时，明确说明版本不确定性，不得编造。
```

Keep the fixed node sequence and answer contract unchanged.

- [ ] **Step 4: Update the Kafka Hysilens Skill**

Apply these semantic replacements:

```text
4.4 标准博弈 → 4.4–4.7 标准博弈
只处理 4.4 版本 → 适用于 4.4–4.7 内容周期
4.4-confirmed → cycle-confirmed
4.4-synthesis → lineup-synthesis
4.4 最高难度实战 → 4.4–4.7 最高难度实战
项目当前 4.4 数据 → 项目当前 4.4 数据基线
```

Retain factual statements that describe changes introduced specifically in 4.4, such as “椒丘：4.4 低费过渡与增伤”.

- [ ] **Step 5: Run focused tests**

```powershell
npx.cmd vitest run tests/prompts/prompt-composer.test.ts tests/resources/skills-resources.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add resources/currency-war/prompts/system.md resources/skills/currency-war-kafka-hysilens-dot tests/prompts/prompt-composer.test.ts tests/resources/skills-resources.test.ts
git commit -m "fix: extend currency war scope through version 4.7"
```

---

### Task 2: Add the Himeko Departure Train Skill

**Files:**
- Modify: `tests/resources/skills-resources.test.ts`
- Create: `resources/skills/currency-war-himeko-departure-train/SKILL.md`
- Create: `resources/skills/currency-war-himeko-departure-train/references/lineup-core.md`
- Create: `resources/skills/currency-war-himeko-departure-train/references/operations.md`
- Create: `resources/skills/currency-war-himeko-departure-train/references/equipment.md`
- Create: `resources/skills/currency-war-himeko-departure-train/references/evidence.md`

**Interfaces:**
- Produces: Skill ID `currency-war-himeko-departure-train`
- Produces: name `Currency War Himeko Departure Train`
- Produces: exactly four references

- [ ] **Step 1: Add a failing resource contract test**

Add a test that initializes the real built-in Skill runtime and asserts:

```ts
const entry = runtime.registry.get("currency-war-himeko-departure-train");
expect(entry).toMatchObject({
  name: "Currency War Himeko Departure Train",
  enabled: true,
  available: true,
  requiredTools: [],
});
expect(entry?.references.map(({ name }) => name)).toEqual([
  "equipment.md",
  "evidence.md",
  "lineup-core.md",
  "operations.md",
]);
```

Read the body and references, then assert:

```ts
expect(body).toContain("姬子·启行—列车同行");
expect(body).toContain("本轮唯一主任务");
expect(body).toContain("最多 5 个");
expect(body).toContain("停止条件");
expect(body).toContain("4.4–4.7");
expect(body).not.toContain("https://");

expect(lineup).toContain("领航员");
expect(lineup).toContain("4 列车同行");
expect(lineup).toContain("量子同频");
expect(operations).toContain("7 级");
expect(operations).toContain("三星姬子");
expect(equipment).toContain("复制装备");
expect(evidence).toContain("cycle-confirmed");
expect(evidence).not.toContain("https://");
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: FAIL because the Skill does not exist.

- [ ] **Step 3: Create `SKILL.md`**

Use:

```yaml
---
name: Currency War Himeko Departure Train
description: 当用户在《货币战争》4.4–4.7 标准博弈最高难度中使用姬子·启行作为前台主输出，或需要围绕列车同行、领航员、量子同频进行购买、站位、升星、升级、刷新、装备、止损或转型决策时使用。
version: "1.0.0"
defaultEnabled: true
tools: []
---
```

The body must route to four references, inspect game state, choose one main task, return at most five ordered actions, specify refresh stop conditions, and plan the next one to three nodes.

Hard constraints:

- Do not force 6 Train Companions at the cost of survival or a formed carry.
- Do not chase three-star Himeko without copies, economy and remaining nodes.
- Do not select the Navigator only by character rarity.
- Do not recommend copied equipment without checking the copy target and position.
- Do not mix Overclock rules.

- [ ] **Step 4: Create `lineup-core.md`**

Extract and rewrite:

- Himeko Departure's front-stage empowerment and output loop.
- Navigator purpose and target-selection factors.
- 2/4/6 Train Companion breakpoints.
- Why 4 Train Companion is the stable default.
- Quantum Frequency and survival modules.
- One-, two- and three-star Himeko priorities.
- Early 2 Train, mid-game two-star Himeko plus 4 Train, 4 Train plus 3 Quantum Frequency, and conditional 6 Train.
- Continue, shallow-transition and full-pivot conditions.

Remove author voice, repeated scope text and source URLs.

- [ ] **Step 5: Create `operations.md`**

Extract and rewrite:

- Plane 1 route signals, rewards, supply and boss preparation.
- Plane 2 level-7 timing, rolling conditions, stop lines and 4 Train target.
- Plane 3 choice between three-star Himeko and leveling for more modules.
- Investment effects grouped by economy, experience, refresh, Train access, equipment and immediate strength.
- One main task per answer and explicit stop-loss conditions.

- [ ] **Step 6: Create `equipment.md`**

Extract and rewrite:

- Two-layer equipment model: Himeko's own equipment and Navigator-copied equipment.
- Navigator selection order: bond breakpoint, first equipment, skill/track changes, then final value.
- Conditional value of 战场进化手册、步步生花 and other candidates.
- Copy target, position and duplicate-value checks.
- No fixed three-piece set as the only answer.

- [ ] **Step 7: Create `evidence.md`**

Use the evidence labels:

```text
cycle-confirmed
post-cycle-guide
lineup-synthesis
needs-validation
```

Summarize confirmed mechanics, post-launch guide experience, inferred strategy and unresolved questions. Do not include raw URLs, publication dates or authoring history.

- [ ] **Step 8: Run the focused test and check file sizes**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: PASS.

Verify all five files are below 16,000 UTF-8 characters.

- [ ] **Step 9: Commit**

```powershell
git add resources/skills/currency-war-himeko-departure-train tests/resources/skills-resources.test.ts
git commit -m "feat: add himeko departure train lineup skill"
```

---

### Task 3: Add the Phainon Counter Armor Skill

**Files:**
- Modify: `tests/resources/skills-resources.test.ts`
- Create: `resources/skills/currency-war-phainon-counter-armor/SKILL.md`
- Create: `resources/skills/currency-war-phainon-counter-armor/references/lineup-core.md`
- Create: `resources/skills/currency-war-phainon-counter-armor/references/operations.md`
- Create: `resources/skills/currency-war-phainon-counter-armor/references/equipment.md`
- Create: `resources/skills/currency-war-phainon-counter-armor/references/evidence.md`

**Interfaces:**
- Produces: Skill ID `currency-war-phainon-counter-armor`
- Produces: name `Currency War Phainon Counter Armor`
- Produces: exactly four references

- [ ] **Step 1: Add a failing resource contract test**

Assert:

```ts
const entry = runtime.registry.get("currency-war-phainon-counter-armor");
expect(entry).toMatchObject({
  name: "Currency War Phainon Counter Armor",
  enabled: true,
  available: true,
  requiredTools: [],
});
expect(entry?.references.map(({ name }) => name)).toEqual([
  "equipment.md",
  "evidence.md",
  "lineup-core.md",
  "operations.md",
]);
```

Content assertions:

```ts
expect(body).toContain("白厄—以牙还牙甲");
expect(body).toContain("本轮唯一主任务");
expect(body).toContain("最多 5 个");
expect(body).toContain("4.4–4.7");
expect(body).not.toContain("https://");

expect(lineup).toContain("直伤白厄");
expect(lineup).toContain("反甲白厄");
expect(lineup).toContain("护盾");
expect(operations).toContain("7 级");
expect(operations).toContain("退回直伤");
expect(equipment).toContain("以牙还牙甲");
expect(equipment).toContain("三件");
expect(evidence).toContain("cycle-confirmed");
expect(evidence).not.toContain("https://");
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: FAIL because the Skill does not exist.

- [ ] **Step 3: Create `SKILL.md`**

Use:

```yaml
---
name: Currency War Phainon Counter Armor
description: 当用户在《货币战争》4.4–4.7 标准博弈最高难度中使用白厄作为前台主输出，尤其考虑以牙还牙甲反伤体系，并需要判断能否成型、前排、装备、升星、升级、刷新、止损或转型时使用。
version: "1.0.0"
defaultEnabled: true
tools: []
---
```

The body must route references, inspect state, choose one main task, give at most five ordered actions, provide stop conditions and plan one to three nodes.

Hard constraints:

- Do not force counter armor without the required equipment signal.
- Do not treat one counter armor as a finished stable build.
- Do not chase a third counter armor at the cost of immediate boss strength.
- Do not ignore shields, front-stage quality, enemy attack pattern or affixes.
- Do not mix Overclock rules.

- [ ] **Step 4: Create `lineup-core.md`**

Extract and rewrite:

- Phainon's current mechanics, “我独自战斗” and “背负希望”.
- Direct-damage versus counter-armor Phainon.
- Why counter armor has high ceiling and low floor.
- Shield core, high-star front-stage and finishing modules.
- Direct transition, one-piece transition, two-piece stable and three-piece high-ceiling states.
- 3 Sea Ranger plus 2 Train Companion skeleton.
- Star-up priorities and roles that should not be forced.

- [ ] **Step 5: Create `operations.md`**

Extract and rewrite:

- Basic signals, strong signals and veto conditions for playing counter armor.
- Plane 1 equipment-first evaluation.
- Plane 2 level-7 timing, Phainon rolling and stop lines.
- Plane 3 choice among three-star Phainon, population and third counter armor.
- Direct-to-counter and counter-to-direct transition rules.
- Enemy and affix suitability.
- Investment categories and boss preparation.

- [ ] **Step 6: Create `equipment.md`**

Extract and rewrite:

- 以牙还牙甲 mechanics and purpose.
- One-piece transition, two-piece stable and three-piece high-ceiling requirements.
- Direct-damage, startup, defense and shield equipment.
- Equipment-holder selection.
- Conditions that forbid sacrificing formed strength for the third piece.

- [ ] **Step 7: Create `evidence.md`**

Use:

```text
cycle-confirmed
detailed-guide
lineup-synthesis
needs-validation
```

Summarize current mechanics, detailed guide evidence, cycle-level validation, strategic inference and unresolved questions without raw URLs or publication history.

- [ ] **Step 8: Run focused tests and check file sizes**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: PASS, with all five files below 16,000 UTF-8 characters.

- [ ] **Step 9: Commit**

```powershell
git add resources/skills/currency-war-phainon-counter-armor tests/resources/skills-resources.test.ts
git commit -m "feat: add phainon counter armor lineup skill"
```

---

### Task 4: Remove Sources, Verify and Push

**Files:**
- Modify: `tests/resources/skills-resources.test.ts`
- Delete: `CURRENCY_WAR_4_4_HIMEKO_DEPARTURE_LINEUP_SKILL.md`
- Delete: `CURRENCY_WAR_4_4_PHAINON_COUNTER_LINEUP_SKILL.md`

- [ ] **Step 1: Add a failing deletion test**

Using `fileURLToPath` and `access`, assert both root files reject with `ENOENT`.

- [ ] **Step 2: Run the resource test and verify failure**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: FAIL because both source files still exist.

- [ ] **Step 3: Delete both root source files**

Use `apply_patch` to delete the two untracked files. Do not stage or commit the original source contents.

- [ ] **Step 4: Run focused Skill tests**

```powershell
npx.cmd vitest run tests/skills tests/resources/skills-resources.test.ts tests/prompts/prompt-composer.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit cleanup**

```powershell
git add tests/resources/skills-resources.test.ts
git commit -m "chore: remove converted lineup source docs"
```

- [ ] **Step 6: Run typecheck**

```powershell
npm.cmd run typecheck
```

Expected: exit code 0.

- [ ] **Step 7: Run all tests**

```powershell
npm.cmd test
```

Expected: all tests PASS.

- [ ] **Step 8: Build Electron and Renderer**

```powershell
npm.cmd run build
```

Expected: both builds succeed.

- [ ] **Step 9: Inspect repository state**

```powershell
git status --short --branch
git log -10 --oneline
```

Expected: clean working tree and all implementation commits present on `main`.

- [ ] **Step 10: Push `main`**

```powershell
git push origin main
```

Expected: GitHub `main` advances to local `main`. If GitHub is unreachable, keep verified local commits and report the exact network error.
