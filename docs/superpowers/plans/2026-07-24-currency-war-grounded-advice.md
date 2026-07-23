# Currency War Grounded Advice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让货币战争 Agent 自动读取本地基础数据和匹配的阵容 Skill，并禁止在没有本地证据时编造游戏事实。

**Architecture:** 使用结构化目录完成精确实体查询，不用向量 RAG 查询角色和装备事实。聊天请求进入模型前，由 Grounding Builder 自动匹配输入实体、选择阵容 Skill、读取 References，并组成带来源标签的证据包；模型仍可通过 `lookup_currency_war_data` 查询证据包外实体。

**Tech Stack:** TypeScript、Electron、Vitest、现有 ToolRegistry、SkillRegistry、CurrencyWarCatalog。

## Global Constraints

- 只覆盖 4.4–4.7 内容周期、标准博弈、默认最高难度。
- `data/currency-war/runtime/4.4` 是结构化实体事实的唯一来源。
- 缺失字段和 `null` 必须表示“本地资料未记录”，不得让模型补全。
- 精确实体事实不使用向量 RAG；向量检索保留给未来的长篇非结构化攻略。
- 不增加新的第三方依赖。
- 每项生产代码改动前必须先运行对应失败测试。

---

### Task 1: 结构化游戏事实查询

**Files:**
- Create: `src/main/currency-war/grounding/currency-war-facts.ts`
- Create: `src/main/currency-war/grounding/currency-war-tools.ts`
- Create: `tests/currency-war/grounding/currency-war-facts.test.ts`
- Create: `tests/currency-war/grounding/currency-war-tools.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarRuntime.gameVersion`、`CurrencyWarRuntime.catalog`、`ToolRegistry.register()`
- Produces: `createCurrencyWarFactService(runtime)`、`CurrencyWarFactService.lookup(names, includeRelated)`、`CurrencyWarFactService.matchText(text)`、`registerCurrencyWarTools(registry, facts)`

- [ ] **Step 1: Write the failing fact-service tests**

```ts
const facts = createCurrencyWarFactService(runtime);
expect(facts.lookup(["阿格莱雅", "爻光"]).records).toMatchObject([
  { type: "characters", name: "阿格莱雅", data: { bonds: ["昼之半神", "能量"] } },
  { type: "characters", name: "爻光", data: { bonds: ["仙舟", "欢愉"] } },
]);
expect(facts.lookup(["长线利好"]).records[0]?.data.effect).toBeNull();
expect(facts.matchText("乱破和藿藿怎么选").map((item) => item.name)).toEqual(["乱破", "藿藿"]);
```

- [ ] **Step 2: Run the fact-service tests and verify RED**

Run: `npm.cmd test -- tests/currency-war/grounding/currency-war-facts.test.ts`

Expected: FAIL because `currency-war-facts.ts` does not exist.

- [ ] **Step 3: Implement compact, typed fact records**

```ts
export interface CurrencyWarFactRecord {
  type: CurrencyWarEntityType;
  name: string;
  data: Record<string, unknown>;
}

export interface CurrencyWarFactService {
  lookup(names: readonly string[], includeRelated?: boolean): CurrencyWarFactResult;
  matchText(text: string): CurrencyWarFactRecord[];
  format(records: readonly CurrencyWarFactRecord[]): string;
}
```

Build a tagged index from `catalog.list(type)`. Preserve `null`, copy only recorded fields, return exact matches before partial-name candidates, cap results at 30, and format missing values as `本地资料未记录`.

- [ ] **Step 4: Run the fact-service tests and verify GREEN**

Run: `npm.cmd test -- tests/currency-war/grounding/currency-war-facts.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing tool tests**

```ts
registerCurrencyWarTools(registry, facts);
const tool = registry.getById("lookup_currency_war_data");
expect(tool?.parameters.required).toEqual(["names"]);
expect(await tool?.execute({ names: ["阿格莱雅", "长线利好"] }))
  .toContain("本地资料未记录");
```

- [ ] **Step 6: Run the tool tests and verify RED**

Run: `npm.cmd test -- tests/currency-war/grounding/currency-war-tools.test.ts`

Expected: FAIL because `registerCurrencyWarTools` does not exist.

- [ ] **Step 7: Implement `lookup_currency_war_data`**

```ts
registerCurrencyWarTools(registry, facts);
```

The tool accepts `names: string[]` and optional `include_related: boolean`. Reject empty names, trim and deduplicate input, cap names at 20, return `data_version: 4.4`, and state that missing data must not be inferred.

- [ ] **Step 8: Run both Task 1 test files and commit**

Run: `npm.cmd test -- tests/currency-war/grounding/currency-war-facts.test.ts tests/currency-war/grounding/currency-war-tools.test.ts`

Expected: PASS.

Commit: `feat: add currency war fact lookup`

---

### Task 2: 自动阵容 Skill 路由与证据包

**Files:**
- Create: `src/main/currency-war/grounding/currency-war-skill-router.ts`
- Create: `src/main/currency-war/grounding/currency-war-grounding.ts`
- Create: `tests/currency-war/grounding/currency-war-skill-router.test.ts`
- Create: `tests/currency-war/grounding/currency-war-grounding.test.ts`

**Interfaces:**
- Consumes: `CurrencyWarFactService` and the existing `SkillRegistry` methods `get()`、`readBody()`、`readReference()`
- Produces: `routeCurrencyWarSkills(text)` and `createCurrencyWarGroundingBuilder({ facts, skills }).build(text)`

- [ ] **Step 1: Write and run failing router tests**

```ts
expect(routeCurrencyWarSkills("我想玩白厄反伤流"))
  .toEqual(["currency-war-phainon-counter-armor"]);
expect(routeCurrencyWarSkills("卡芙卡和海瑟音怎么运营"))
  .toEqual(["currency-war-kafka-hysilens-dot"]);
expect(routeCurrencyWarSkills("姬子启行什么时候发车"))
  .toEqual(["currency-war-himeko-departure-train"]);
```

Run: `npm.cmd test -- tests/currency-war/grounding/currency-war-skill-router.test.ts`

Expected: FAIL because the router does not exist.

- [ ] **Step 2: Implement deterministic route rules**

Use normalized text and fixed keyword groups. Return at most two distinct Skill IDs; ordinary single-lineup questions return one. Do not call an LLM for routing.

- [ ] **Step 3: Write and run failing grounding tests**

```ts
const pack = await builder.build("阿格莱雅和爻光在场，我想玩白厄反伤");
expect(pack).toContain("## 货币战争本轮证据包");
expect(pack).toContain("阿格莱雅");
expect(pack).toContain("昼之半神");
expect(pack).toContain("currency-war-phainon-counter-armor");
expect(skills.readBody).toHaveBeenCalledWith("currency-war-phainon-counter-armor");
expect(skills.readReference).toHaveBeenCalled();
```

Run: `npm.cmd test -- tests/currency-war/grounding/currency-war-grounding.test.ts`

Expected: FAIL because the builder does not exist.

- [ ] **Step 4: Implement the grounding builder**

```ts
export interface CurrencyWarGroundingBuilder {
  build(text: string): Promise<string>;
}
```

Match facts in the user text, load the routed Skill body and its References, scan the loaded Skill text for additional catalog entities, and output:

```text
## 货币战争本轮证据包
数据版本：4.4
### 基础库事实
...
### 已加载攻略 Skill
...
### 使用约束
只允许根据本证据包和本轮工具结果陈述游戏事实。
```

Cap loaded Skill content at 32,000 characters and fact records at 30. Disabled, unavailable or failed Skills receive an explicit error label rather than fabricated content.

- [ ] **Step 5: Run Task 2 tests and commit**

Run: `npm.cmd test -- tests/currency-war/grounding/currency-war-skill-router.test.ts tests/currency-war/grounding/currency-war-grounding.test.ts`

Expected: PASS.

Commit: `feat: build grounded currency war evidence`

---

### Task 3: 接入 Electron 聊天运行链

**Files:**
- Modify: `src/main/app/main.ts`
- Modify: `src/main/app/register-chat-ipc.ts`
- Modify: `tests/main/register-chat-ipc.test.ts`
- Modify: `tests/resources/skills-resources.test.ts`
- Modify: `resources/skills/currency-war-phainon-counter-armor/SKILL.md`
- Modify: `resources/skills/currency-war-himeko-departure-train/SKILL.md`
- Modify: `resources/skills/currency-war-kafka-hysilens-dot/SKILL.md`

**Interfaces:**
- Consumes: `createCurrencyWarFactService`、`registerCurrencyWarTools`、`createCurrencyWarGroundingBuilder`
- Produces: optional `RegisterChatIpcDeps.currencyWarGrounding.build(text)` dependency and a System Message containing the evidence pack

- [ ] **Step 1: Add the failing chat-integration test**

```ts
const currencyWarGrounding = { build: vi.fn(async () => "GROUNDING PACK") };
const deps = createFakeDeps(runAgent, { currencyWarGrounding });
await send({ sender }, "我想玩白厄反伤");
expect(currencyWarGrounding.build).toHaveBeenCalledWith("我想玩白厄反伤");
expect(runAgent.mock.calls[0][0].messages[0].content).toContain("GROUNDING PACK");
```

Also test that a builder failure inserts a strict “game evidence unavailable” notice and does not crash the chat request.

- [ ] **Step 2: Run the chat test and verify RED**

Run: `npm.cmd test -- tests/main/register-chat-ipc.test.ts`

Expected: FAIL because `currencyWarGrounding` is not a recognized dependency and is not injected.

- [ ] **Step 3: Inject the evidence pack into the current request**

Call `currencyWarGrounding.build(text)` after memory recall and before composing `promptParts`. Add its result after the core prompt and before memory context. Catch failures and inject a short restriction that forbids concrete game claims when evidence is unavailable.

- [ ] **Step 4: Wire the runtime in `main.ts`**

Load `CurrencyWarRuntime` immediately after creating the base tool registry, create the fact service, register `lookup_currency_war_data`, then initialize Skills so their required tool is recognized. Create the Grounding Builder after Skill initialization and pass it to `registerChatIpc`.

- [ ] **Step 5: Require the lookup tool in all three game Skills**

```yaml
tools:
  - lookup_currency_war_data
```

Update resource tests to assert all three Skills remain enabled and available and list the required tool.

- [ ] **Step 6: Run integration/resource tests and commit**

Run: `npm.cmd test -- tests/main/register-chat-ipc.test.ts tests/resources/skills-resources.test.ts`

Expected: PASS.

Commit: `feat: ground currency war chat requests`

---

### Task 4: 严格证据 Prompt 契约

**Files:**
- Modify: `resources/currency-war/prompts/system.md`
- Modify: `tests/prompts/prompt-composer.test.ts`

**Interfaces:**
- Consumes: evidence pack and `lookup_currency_war_data` tool result
- Produces: a System Prompt that forbids unsupported game facts and distinguishes facts, guides and deductions

- [ ] **Step 1: Write the failing Prompt assertions**

```ts
expect(prompt).toContain("没有证据，不得陈述");
expect(prompt).toContain("lookup_currency_war_data");
expect(prompt).toContain("字段为 null");
expect(prompt).toContain("【基础库】");
expect(prompt).toContain("【攻略 Skill】");
expect(prompt).toContain("【策略推导】");
```

- [ ] **Step 2: Run the Prompt test and verify RED**

Run: `npm.cmd test -- tests/prompts/prompt-composer.test.ts`

Expected: FAIL because the strict evidence contract is absent.

- [ ] **Step 3: Rewrite the evidence section**

Require exact lookup for entity facts, automatic Skill evidence for lineup guidance, no pretraining-memory completion, explicit unknown handling, and concise source labels on decisive recommendations. State that structured data overrides conflicting guide text for entity facts.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm.cmd test -- tests/prompts/prompt-composer.test.ts tests/currency-war/grounding tests/main/register-chat-ipc.test.ts tests/resources/skills-resources.test.ts`

Expected: PASS.

Commit: `fix: require evidence for currency war advice`

---

### Task 5: 完整验证

**Files:**
- Verify only; no planned production changes.

**Interfaces:**
- Consumes: all prior tasks
- Produces: verified build and synchronized `main`

- [ ] **Step 1: Run static and full automated verification**

Run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: all commands exit with code 0.

- [ ] **Step 2: Inspect final scope**

Run:

```powershell
git status --short --branch
git log --oneline -8
```

Expected: only intentional commits, no uncommitted files, `main` ahead of `origin/main`.

- [ ] **Step 3: Push and verify**

Run:

```powershell
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: local and remote hashes match.
