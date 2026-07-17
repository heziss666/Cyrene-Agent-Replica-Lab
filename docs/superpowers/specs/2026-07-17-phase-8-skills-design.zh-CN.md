# Phase 8：Skills 系统设计

## 1. 背景与目标

Phase 7 已经完成长期记忆、治理、生命周期、反思、压缩和实体关系图。Phase 8 在现有 Tool Agent、Prompt、Electron IPC 和事件系统之上增加本地 Skills，使 Agent 能够发现针对特定任务的操作说明，并在需要时按需加载，而不是把所有说明永久塞进 System Prompt。

Phase 8 的最终目标是建立以下闭环：

```text
扫描内置和用户 Skill
→ 将简短目录加入 System Prompt
→ 模型或用户选择 Skill
→ 按需加载 SKILL.md 正文
→ 按需读取 Reference
→ 使用已有工具执行任务
→ Electron UI 管理启用状态和查看事件
```

Skill 是指令层，不是权限层。一个 Skill 可以告诉模型如何组合现有工具，但不能自行注册未审核的工具、执行任意脚本或突破 Main/Preload/Renderer 的权限边界。

## 2. 设计原则

1. 采用渐进式加载：System Prompt 只包含 Skill ID、描述和工具需求，正文通过 `invoke_skill` 按需读取。
2. Skill 不能产生新权限：只能引用当前 ToolRegistry 已注册并启用的工具。
3. 内置 Skill 与用户 Skill 使用同一格式；用户 Skill 可按 ID 覆盖内置 Skill，但 UI 必须显示来源。
4. 文件系统内容视为不可信输入，所有路径、大小、Frontmatter 和 Reference 都必须校验。
5. 单个 Skill 失败不影响普通聊天和其他 Skill。
6. 运行时对象通过依赖注入组装，不使用源项目的全局 Registry 单例。
7. Phase 8 不提前实现 MCP、远程市场、任意脚本执行或 Skill 自修改。

## 3. 阶段划分

### 3.1 Phase 8A：Skill 基础设施

实现类型、Frontmatter 解析、双目录扫描、Registry 和 Catalog。完成后系统能够可靠发现 Skill，并生成可注入 Prompt 的简短目录，但暂不要求 UI 管理。

### 3.2 Phase 8B：渐进式激活

实现 `invoke_skill`、`read_skill_reference`、自动激活、`/skill-id` 手动激活、每轮去重和 Skill 事件。完成后模型能真正读取并遵循 Skill。

### 3.3 Phase 8C：状态持久化与管理界面

实现启用状态、重新扫描、Skills IPC、Preload API 和 Renderer Skills 视图。

### 3.4 Phase 8D：内置 Skill、文档与验收

加入能够由当前工具栈真实执行的内置 Skill，完成学习文档、真实 Electron 验收和路线图更新。

## 4. 目录约定

内置 Skill 放在打包资源中：

```text
resources/skills/<skill-id>/SKILL.md
resources/skills/<skill-id>/references/*
```

用户 Skill 放在 Electron 用户数据目录：

```text
<userData>/skills/<skill-id>/SKILL.md
<userData>/skills/<skill-id>/references/*
```

一个最小 Skill：

```markdown
---
name: agent-learning-tutor
description: 当用户希望学习当前 Agent 项目的代码、架构或工作流时使用。
version: 1.0.0
tools:
  - search_knowledge
---

# Agent Learning Tutor

先确认用户正在阅读的模块，再检索相关知识，最后按“通俗作用、专业名称、代码链路”的顺序解释。
```

Skill ID 固定使用目录名，必须匹配 `^[a-z0-9][a-z0-9-]*$`。Frontmatter 的 `name` 用于展示，不作为查找键。

## 5. 数据模型

核心运行时结构：

```ts
export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version?: string;
  requiredTools: string[];
  source: "builtin" | "user";
  rootPath: string;
  bodyPath: string;
  references: SkillReference[];
  enabled: boolean;
  available: boolean;
  unavailableReasons: string[];
}

export interface SkillReference {
  name: string;
  path: string;
  sizeBytes: number;
}

export interface SkillDiagnostic {
  source: "builtin" | "user";
  path: string;
  code: string;
  message: string;
}
```

扫描结果同时返回有效 Skill 和诊断，损坏目录不会通过异常终止整个扫描。

## 6. 解析和扫描

使用结构化 YAML Frontmatter 解析库，不使用手写字符串拆分。必填字段为非空 `name` 和 `description`；`version` 必须是字符串；`tools` 必须是无重复字符串数组。

扫描器依次扫描内置目录和用户目录。合并时先加入内置 Skill，再由同 ID 用户 Skill 整体覆盖。覆盖不是字段合并，避免正文、Reference 和工具声明来自不同来源。

扫描安全规则：

- 拒绝绝对 Reference 路径和包含 `..` 的路径。
- 通过 `realpath` 确认 SKILL.md 和 Reference 的真实路径仍位于对应 Skill 根目录。
- 拒绝逃逸根目录的符号链接；目录读取失败生成诊断。
- 描述最长 500 字符，Skill 正文最大 16,000 字符，单个 Reference 最大 16,000 字符，每个 Skill 最多 32 个 Reference。
- 超限内容不截断后继续执行，而是将 Skill 或 Reference 标记为不可用，防止关键约束被截断。
- Catalog 最多暴露 100 个可用 Skill；超出的 Skill保留在 UI，并产生诊断。

## 7. SkillRegistry

Registry 由 `main.ts` 创建，并注入 Prompt、Tool 和 IPC 模块。它负责：

- 按 ID 查询全部、启用和可用 Skill。
- 按需异步读取并缓存 SKILL.md 正文。
- 只允许读取扫描时建立白名单的 Reference。
- 重新扫描时替换完整快照并清空正文缓存。
- 合并持久化启用状态并重新计算工具可用性。

`available` 与 `enabled` 含义不同：`enabled` 是用户选择；`available` 表示格式、安全检查和工具依赖均满足。只有两者同时为真时才进入 Catalog 和允许激活。

## 8. Skill Catalog 与 Prompt

Catalog 放在人格 Prompt 之后、临时记忆上下文之前，只包含：

```text
## Available Skills
当某个 Skill 的描述与当前任务匹配时，先调用 invoke_skill 获取详细指令。
- agent-learning-tutor: 当用户学习 Agent 项目代码或架构时使用。 [tools: search_knowledge]
```

不在 Catalog 中注入正文、Reference 内容、文件路径或禁用/不可用 Skill。通用 Catalog 不包含源项目针对 Excel、Word 等产品的硬编码歧义规则；此类规则应属于对应 Skill 正文。

## 9. Meta Tools

### 9.1 `invoke_skill`

输入：

```json
{ "skill_id": "agent-learning-tutor" }
```

成功时返回 Skill 正文、可用 Reference 名称和执行纪律。失败时返回稳定错误码，不泄露本地绝对路径。

### 9.2 `read_skill_reference`

输入：

```json
{
  "skill_id": "agent-learning-tutor",
  "reference": "examples.md"
}
```

只允许读取该 Skill 扫描快照中的白名单文件。正文和 Reference 在同一 Agent Run 中只返回一次，重复调用返回简短提示。

Meta Tool 与普通工具一样经过 ToolRegistry、Tool Agent 和 AgentEvent，不拥有额外文件权限。

## 10. 自动与手动激活

自动激活由模型根据 Catalog 描述决定。调用 `invoke_skill` 后，正文作为 Tool Result 加入当前 Agent Loop，模型继续推理并使用现有工具。

手动命令格式：

```text
/agent-learning-tutor 请解释 ToolRegistry
```

聊天 Handler 只在第一个 Token 完整匹配已知、启用且可用的 Skill ID 时命中。命中后移除命令前缀，将剩余文本作为用户任务；Skill 正文作为本轮临时 System 补充，不写入 ChatSession 历史。空任务返回参数错误，不调用模型。

## 11. 事件

新增领域事件：

```text
skill_activated
skill_reference_loaded
skill_load_failed
```

事件包含 `runId`、`skillId`，Reference 事件额外包含文件名；失败事件只包含安全错误码。通用 `tool_started` 和 `tool_finished` 继续存在，领域事件用于 Renderer 清楚区分 Skill 加载与普通工具执行。

## 12. 持久化与 IPC

启用状态保存到：

```text
<userData>/skills-settings.json
```

格式包含 `schemaVersion` 和 `enabledById`，使用原子写入；文件损坏时隔离并回退默认状态。

新增 Channel：

```text
cyrene:skills:list
cyrene:skills:set-enabled
cyrene:skills:reload
```

Preload 暴露：

```ts
window.cyrene.skills.list()
window.cyrene.skills.setEnabled(id, enabled)
window.cyrene.skills.reload()
```

Main 必须再次校验所有 IPC Payload。Renderer 不能传入任意路径，重新扫描只能扫描固定的内置和用户根目录。

## 13. Renderer Skills 视图

增加 Skills 标签页，展示 ID、名称、描述、版本、来源、启用状态、可用状态、所需工具、Reference 文件名和诊断。

交互包括启用/禁用开关和重新扫描按钮。不可用 Skill 的开关禁用并显示原因；用户覆盖内置 Skill 时明确显示 `user` 来源。界面不直接编辑文件，也不执行 Skill 脚本。

## 14. 内置 Skills

Phase 8 首批加入：

1. `agent-learning-tutor`：使用 `search_knowledge` 和按需 Reference，按当前项目偏好的教学方式解释代码。
2. `cyrene-original-voice`：提供可选原始文字表达风格，默认禁用；不包含语音合成、通话或音频能力。

暂不加入 `skill-creator` 和 `self-improving-agent`。它们依赖受控文件写入、脚本执行和 Hook；在这些能力尚未实现时加入只会产生无法兑现的说明。后续阶段具备安全工具后再迁移。

## 15. 错误处理

- 扫描错误：记录诊断，继续加载其他 Skill。
- 激活未知、禁用或不可用 Skill：返回稳定 Tool Error，Agent Loop 继续。
- Reference 不存在或越界：拒绝并记录 `skill_load_failed`。
- 设置文件损坏：隔离文件并使用默认启用状态。
- 重新扫描失败：保留上一个有效 Registry 快照，避免正在运行的聊天突然失去全部 Skill。
- Agent Run 内文件在扫描后发生变化：读取失败即拒绝，不临时扩大白名单。

## 16. 并发与生命周期

重新扫描通过串行执行器运行。每个 Agent Run 获得独立的 Skill 读取状态，不使用进程级全局 `readRefs`。关闭应用时，已接受的扫描和设置写入任务纳入现有优雅关闭屏障。

正在执行的 Agent Run 使用开始时取得的 Registry 快照；UI 重新扫描只影响之后的 Run，避免同一轮中 Catalog 与可读取正文不一致。

## 17. 测试策略

Phase 8 使用 TDD，至少覆盖：

- Frontmatter 合法/非法、ID、重复工具和大小限制。
- 双目录扫描、用户覆盖、缺失目录和结构化诊断。
- `realpath` 路径 containment、`..`、绝对路径和符号链接逃逸。
- Registry 缓存、快照替换、启用状态和缺失工具。
- Catalog 只包含启用且可用 Skill，并符合 Token 上限。
- Meta Tool 成功、失败、正文/Reference 白名单和每轮去重。
- 自动工具调用和 `/skill-id` 手动注入的 Agent 集成。
- Skill 事件格式与 Renderer 显示。
- IPC 参数验证、设置持久化、损坏恢复和 UI 状态。
- 打包后的内置资源路径、全量 Vitest、typecheck、build 和真实 Electron 冒烟测试。

## 18. 完成标准

Phase 8 只有同时满足以下条件才完成：

1. 内置和用户 Skill 能被安全扫描并在 UI 中管理。
2. Catalog 不包含正文，模型能通过 Meta Tool 渐进加载。
3. 手动和自动激活都可工作，读取状态按 Run 隔离。
4. 禁用、不可用和损坏 Skill 不影响普通聊天。
5. 用户覆盖、设置持久化、重新扫描和打包资源均通过测试。
6. 两个内置 Skill 在真实 Electron + DeepSeek 环境中完成验收。
7. 中文学习文档解释 Skill 与 Prompt、Tool、MCP 的区别及完整调用链。

## 19. 非目标与后续阶段

Phase 8 不实现：

- 任意 Skill 脚本自动执行。
- 在线 Skill 市场、Git 下载和自动更新。
- MCP Server 或远程工具注册。
- Skill 自动修改自身。
- Voice、Live2D 和外部消息 Channel。

MCP 留到 Phase 9；定时任务与 Hook 扩展留到 Phase 10；文件写入与脚本权限成熟后，再评估 `skill-creator` 和 `self-improving-agent`。
