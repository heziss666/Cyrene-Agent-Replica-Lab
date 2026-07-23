# Currency War Kafka Hysilens DoT Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将根目录的货币战争攻略重写为可被 SkillRegistry 自动发现、按需读取的“卡芙卡—海瑟音持续伤害阵容”Skill，并删除两份不再需要的根目录原稿。

**Architecture:** `SKILL.md` 只承载触发条件、分析流程和输出契约，详细阵容、运营、装备和可信度知识拆到四个 Reference。Skill 不声明 `search_knowledge`，因为当前知识库尚未载入货币战争资料。

**Tech Stack:** Markdown、YAML frontmatter、TypeScript、Vitest、项目现有 SkillRegistry。

## Global Constraints

- Skill ID 固定为 `currency-war-kafka-hysilens-dot`。
- Skill 名称固定为 `Currency War Kafka Hysilens DoT`。
- 只适用于货币战争 4.4、标准博弈、默认最高难度。
- 聚焦以卡芙卡和海瑟音为核心、黑天鹅和椒丘等成员参与的持续伤害体系。
- `defaultEnabled: true`，`tools: []`。
- `SKILL.md` 只放每次触发都需要的决策流程；详细攻略按需读取。
- 不实现货币战争 RAG、专用查询工具或其他阵容 Skill。
- 验证完成后删除 `CURRENCY_WAR_4_4_DOT_LINEUP_SKILL.md` 和 `CURRENCY_WAR_GAMEPLAY_RULES_FOR_AGENT.md`。

---

## File Structure

- Create: `resources/skills/currency-war-kafka-hysilens-dot/SKILL.md`
  - 触发范围、输入检查、Reference 路由、唯一主任务、操作顺序和停止线。
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/lineup-core.md`
  - 体系原理、角色定位、阵容形态、升星和转型。
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/operations.md`
  - 三个位面运营、升级、刷新、止损和投资选择。
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/equipment.md`
  - 装备分配与核心成员需求。
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/evidence.md`
  - 结论等级、4.4 变化和待验证事项。
- Modify: `tests/resources/skills-resources.test.ts`
  - 验证正式 Skill 可发现、可读取且内容边界正确。
- Delete: `CURRENCY_WAR_4_4_DOT_LINEUP_SKILL.md`
- Delete: `CURRENCY_WAR_GAMEPLAY_RULES_FOR_AGENT.md`

---

### Task 1: Add a Failing Runtime Resource Test

**Files:**
- Modify: `tests/resources/skills-resources.test.ts`

**Interfaces:**
- Consumes: `createSkillRuntime(...)`
- Produces: runtime contract for `currency-war-kafka-hysilens-dot`

- [ ] **Step 1: Add the missing imports**

Change the Node imports to include:

```ts
import { access, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
```

- [ ] **Step 2: Add a failing discovery and content test**

Add:

```ts
it("loads the Kafka Hysilens DoT skill with focused references", async () => {
  const userData = await mkdtemp(join(tmpdir(), "currency-war-dot-skill-"));
  const runtime = await createSkillRuntime({
    builtinRoot: defaultBuiltinSkillsRoot(),
    userRoot: join(userData, "skills"),
    settingsPath: join(userData, "settings.json"),
    toolIds: ["search_knowledge"],
  });

  expect(runtime.registry.get("currency-war-kafka-hysilens-dot")).toMatchObject({
    name: "Currency War Kafka Hysilens DoT",
    enabled: true,
    available: true,
    requiredTools: [],
  });
  expect(runtime.registry.get("currency-war-kafka-hysilens-dot")?.references
    .map((reference) => reference.name)).toEqual([
      "equipment.md",
      "evidence.md",
      "lineup-core.md",
      "operations.md",
    ]);

  const body = await runtime.registry.readBody("currency-war-kafka-hysilens-dot");
  expect(body).toContain("卡芙卡—海瑟音");
  expect(body).toContain("本轮唯一主任务");
  expect(body).toContain("最多 5 个");
  expect(body).toContain("停止条件");
  expect(body).not.toContain("https://");

  const lineup = await runtime.registry.readReference(
    "currency-war-kafka-hysilens-dot",
    "lineup-core.md",
  );
  expect(lineup).toContain("卡芙卡");
  expect(lineup).toContain("海瑟音");
  expect(lineup).toContain("黑天鹅");
  expect(lineup).toContain("椒丘");
  expect(lineup).toContain("6 持续伤害");

  const operations = await runtime.registry.readReference(
    "currency-war-kafka-hysilens-dot",
    "operations.md",
  );
  expect(operations).toContain("第一位面");
  expect(operations).toContain("第二位面");
  expect(operations).toContain("第三位面");
  expect(operations).toContain("止损");

  const evidence = await runtime.registry.readReference(
    "currency-war-kafka-hysilens-dot",
    "evidence.md",
  );
  expect(evidence).toContain("4.4-confirmed");
  expect(evidence).toContain("needs-validation");
  expect(evidence).not.toContain("https://");
});
```

- [ ] **Step 3: Run the test and verify the RED state**

Run:

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: FAIL because `currency-war-kafka-hysilens-dot` does not exist.

- [ ] **Step 4: Commit the failing test**

```powershell
git add tests/resources/skills-resources.test.ts
git commit -m "test: define kafka hysilens dot skill contract"
```

---

### Task 2: Create the Progressive-Disclosure Skill

**Files:**
- Create: `resources/skills/currency-war-kafka-hysilens-dot/SKILL.md`
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/lineup-core.md`
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/operations.md`
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/equipment.md`
- Create: `resources/skills/currency-war-kafka-hysilens-dot/references/evidence.md`

**Interfaces:**
- Produces: Skill ID `currency-war-kafka-hysilens-dot`
- Produces: references `lineup-core.md`, `operations.md`, `equipment.md`, `evidence.md`
- Constraint: every file must be below the scanner's 16,000-character limit

- [ ] **Step 1: Create `SKILL.md`**

Use this frontmatter:

```yaml
---
name: Currency War Kafka Hysilens DoT
description: 当用户在《货币战争》4.4 标准博弈最高难度中考虑、运营或调整以卡芙卡和海瑟音为核心的持续伤害阵容，或围绕黑天鹅、椒丘等成员进行购买、站位、升星、升级、刷新、装备、止损或转型决策时使用。
version: "1.0.0"
defaultEnabled: true
tools: []
---
```

Body must contain these sections:

```md
# 卡芙卡—海瑟音持续伤害阵容

## 使用范围
明确 4.4、标准博弈、最高难度，以及不适用于无 DoT 取舍的其他阵容。

## 按需读取
- 阵容与角色：`lineup-core.md`
- 升级、刷新、经济和节点：`operations.md`
- 装备：`equipment.md`
- 版本可信度：`evidence.md`
一次通常只读取最相关的 1 至 2 份。

## 输入检查
列出节点、生命、等级、经验、货币、阵容、商店、装备、羁绊、环境、策略和顾问。

## 决策流程
从保经济、补即时战力、关键升星、升级人口、找海瑟音、找黑天鹅、4 DoT、条件式 6 DoT、转型中选择本轮唯一主任务。

## 回答契约
按当前判断、最多 5 个操作、停止条件、原因、备选和后续 1 至 3 节点输出。

## 硬约束
禁止未解锁时找桑博、裸装卡芙卡、无条件追三星、为 6 DoT 破坏生存、无停止线地刷新，以及把推断说成硬规则。
```

- [ ] **Step 2: Create `lineup-core.md`**

Extract and rewrite the source into:

1. 输出循环：施加 DoT、卡芙卡引爆、羁绊超激发、黑天鹅奥迹、海瑟音扩散。
2. 核心定位：
   - 卡芙卡：2 费前/后台引爆发动机，优先二星且必须携带有效装备。
   - 海瑟音：4 费前台中后期主输出，一星可用、二星主目标。
   - 黑天鹅：5 费后台后期上限，一星成型、二星提高第三位面上限。
   - 椒丘：1 费前台 4.4 过渡与增伤成员，不为三星延误升 8。
   - 艾丝妲：低费过渡，后期按星级、副羁绊和人口决定是否保留。
   - 桑博：专家顾问，未解锁时不能作为普通商店目标。
   - 千冶·刃：2 费可选星核猎手模块，不为他破坏 4 DoT。
3. 阵容形态：前期 2 DoT、中期 4 DoT、后期 4 DoT 加功能位、条件式 6 DoT。
4. 升星优先级：海瑟音二星、卡芙卡二星；黑天鹅二星依局面；低费自然二星。
5. 转型判断：继续投入、浅度过渡、完全转型三类条件。

Remove author voice, repeated version warnings, source URLs and fixed nine-character mandates.

- [ ] **Step 3: Create `operations.md`**

Organize the source as:

1. 第一位面：建立 2 DoT 和健康经济，不强追海瑟音或黑天鹅。
2. 第二位面：卡芙卡二星、升 8 找海瑟音、完成 4 DoT；写明 6 级停留条件和 8 级刷新止损。
3. 第三位面：海瑟音二星后升 9，寻找黑天鹅和功能位，提高最终首领上限。
4. 每轮主任务选择表。
5. 刷新停止线：目标出现、关键二星完成、货币底线到达或投入未改善局面时停止。
6. 投资环境与策略按经济、免费刷新、经验、升星、装备、即时战力和生命止损分类。

Use the fixed node sequence already confirmed by the project. Do not copy obsolete claims that node order is random.

- [ ] **Step 4: Create `equipment.md`**

Organize the source as:

1. 总优先级：卡芙卡有效装备、海瑟音主输出装备、黑天鹅终结技/后台装备、其余成员。
2. 卡芙卡：至少一件有效装备，优先速度、行动频率、团队易伤和终结技循环。
3. 海瑟音：能量/启动、前台强度、速度或持续增益。
4. 黑天鹅：终结技启动、后台强度、持续伤害和能量。
5. 椒丘与艾丝妲：只使用核心剩余的速度、能量和辅助装备。
6. 千冶·刃：可穿满次优有效装备利用自身机制，不抢海瑟音核心装备。
7. 装备名称只作为有条件例子，不写成唯一三件套。

- [ ] **Step 5: Create `evidence.md`**

Include:

```md
# 结论等级

- `4.4-confirmed`：4.4 公告、当前页面或项目结构化数据确认的事实。
- `historical-guide`：旧攻略的运营骨架，不能直接证明当前名单或强度。
- `4.4-synthesis`：结合当前数据形成的策略判断，不是硬规则。
- `needs-validation`：需要 4.4 最高难度实战继续验证。
```

Then summarize:

- 椒丘加入 DoT、桑博变为专家顾问、DoT 羁绊与超激发加强、千冶·刃加入等 4.4 变化。
- 仍需验证的角色替换、千冶·刃模块、不同首领装备、6 DoT 机会成本和生命止损线。
- Agent 如何表达不同等级的结论。

Do not retain raw URLs, publication dates,转载说明 or authoring history.

- [ ] **Step 6: Run the focused test**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Check file sizes**

```powershell
Get-ChildItem -Recurse resources/skills/currency-war-kafka-hysilens-dot -File |
  Select-Object Name,Length
```

Expected: all five files are non-empty and each contains fewer than 16,000 UTF-8 characters.

- [ ] **Step 8: Commit the Skill**

```powershell
git add resources/skills/currency-war-kafka-hysilens-dot tests/resources/skills-resources.test.ts
git commit -m "feat: add kafka hysilens dot lineup skill"
```

---

### Task 3: Remove Superseded Root Documents

**Files:**
- Delete: `CURRENCY_WAR_4_4_DOT_LINEUP_SKILL.md`
- Delete: `CURRENCY_WAR_GAMEPLAY_RULES_FOR_AGENT.md`
- Modify: `tests/resources/skills-resources.test.ts`

**Interfaces:**
- Preserves: all runtime knowledge needed by the new Skill
- Removes: root-only source documents

- [ ] **Step 1: Add a failing deletion test**

Add:

```ts
it("does not retain superseded root currency war documents", async () => {
  const projectRoot = resolve(new URL("../..", import.meta.url).pathname);
  await expect(access(join(projectRoot, "CURRENCY_WAR_4_4_DOT_LINEUP_SKILL.md")))
    .rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(join(projectRoot, "CURRENCY_WAR_GAMEPLAY_RULES_FOR_AGENT.md")))
    .rejects.toMatchObject({ code: "ENOENT" });
});
```

On Windows, normalize the URL path with `fileURLToPath(new URL("../..", import.meta.url))` instead of `.pathname`; import `fileURLToPath` from `node:url`.

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: FAIL while both root files still exist.

- [ ] **Step 3: Delete both source documents**

Use `apply_patch` deletion for:

```text
CURRENCY_WAR_4_4_DOT_LINEUP_SKILL.md
CURRENCY_WAR_GAMEPLAY_RULES_FOR_AGENT.md
```

The first file is untracked, so deletion removes it locally without creating a Git deletion record. The second file is tracked and must appear as a deletion in `git diff`.

- [ ] **Step 4: Run the focused test**

```powershell
npx.cmd vitest run tests/resources/skills-resources.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit cleanup**

```powershell
git add tests/resources/skills-resources.test.ts CURRENCY_WAR_GAMEPLAY_RULES_FOR_AGENT.md
git commit -m "chore: remove superseded currency war source docs"
```

---

### Task 4: Full Verification and Push

**Files:**
- Verify only.

- [ ] **Step 1: Run Skill tests**

```powershell
npx.cmd vitest run tests/skills tests/resources/skills-resources.test.ts
```

Expected: all Skill tests PASS.

- [ ] **Step 2: Run typecheck**

```powershell
npm.cmd run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run all tests**

```powershell
npm.cmd test
```

Expected: all tests PASS.

- [ ] **Step 4: Build Electron and Renderer**

```powershell
npm.cmd run build
```

Expected: TypeScript Electron build and Vite Renderer build complete successfully.

- [ ] **Step 5: Inspect the final repository**

```powershell
git status --short --branch
git log -8 --oneline
```

Expected: no uncommitted files and `main` contains the Skill, cleanup, plan and design commits.

- [ ] **Step 6: Push `main`**

```powershell
git push origin main
```

Expected: GitHub `main` advances to the verified local `main`. If GitHub is unreachable, retain all local commits and report the network error without claiming the push succeeded.
