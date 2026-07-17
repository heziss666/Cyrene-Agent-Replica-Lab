# Phase 8：Skills 系统学习指南

## 1. 先用一句人话说明 Skill

Skill 是一份写给模型看的“特定任务操作手册”。

模型平时只知道有哪些手册以及各自适合什么任务。当它发现当前问题与某本手册匹配时，再通过 `invoke_skill` 把正文取出来；正文提到某份补充材料时，再通过 `read_skill_reference` 读取那一份 Reference。

它解决的是两个问题：

1. System Prompt 不需要永久携带所有任务说明，节省 Token，也减少互相冲突的指令。
2. 不同任务的经验可以独立存放、启用、停用和由用户覆盖。

## 2. Skill 不是什么

Skill 不是工具，也不是权限。

- `Tool` 是模型可以执行的动作，例如检索知识库、计算或获取时间。
- `Skill` 是告诉模型如何组合已有动作的说明。
- `Prompt` 是发给模型的上下文，Skill Catalog 和被激活的 Skill 最终都会以 Prompt 或 Tool Result 的形式进入上下文。
- `IPC` 是 Electron Renderer 与 Main 之间的消息通道，只负责界面管理 Skill。
- `MCP` 是连接外部工具和资源的协议，本阶段没有实现。

例如 `agent-learning-tutor` 声明需要 `search_knowledge`。这表示它可以指导模型先检索项目知识再解释，但它不会因为写了这个名字就自动得到文件读取或网络访问权限。

## 3. 一个 Skill 的文件结构

```text
resources/skills/agent-learning-tutor/
├── SKILL.md
└── references/
    └── workflow.md
```

`SKILL.md` 分为两部分：

```markdown
---
name: Agent Learning Tutor
description: 什么时候应该使用它
version: "1.0.0"
defaultEnabled: true
tools:
  - search_knowledge
---

# 正文

这里写完整操作说明。
```

上面的 YAML 区域叫 Frontmatter，相当于 Skill 的身份证；下面的 Markdown 是模型真正执行任务时遵守的正文。

目录名才是稳定 ID，例如 `agent-learning-tutor`。`name` 是界面显示名称，修改显示名称不会改变调用 ID。

## 4. 内置与用户 Skill

内置目录：

```text
resources/skills/<skill-id>/
```

Electron 用户目录：

```text
<userData>/skills/<skill-id>/
```

扫描时先读取内置目录，再读取用户目录。用户目录里出现同 ID Skill 时，会整体替换内置版本，不会把两个 `SKILL.md` 的字段和正文混合。

这叫 override（覆盖）。整体覆盖比字段合并更容易判断最终生效的内容来自哪里。

## 5. 启动时发生了什么

入口在 `src/main/app/main.ts`：

```text
Electron 启动
→ 创建普通 ToolRegistry
→ createSkillRuntime(...)
→ 扫描内置和用户 Skill
→ 读取 skills-settings.json
→ 根据普通工具计算 available
→ 注册 invoke_skill/read_skill_reference
→ 把同一个 SkillRegistry 交给 Chat IPC 和 Skills IPC
```

这里先创建普通工具，是因为 SkillRegistry 必须知道 `tools` 中声明的工具是否真的存在。

`enabled` 和 `available` 不一样：

- `enabled`：用户是否希望开启它。
- `available`：格式、安全检查和工具依赖是否全部满足。

只有两者都为 `true`，Skill 才能进入 Catalog 并被激活。

## 6. 自动激活的完整链路

假设用户问：“结合代码解释 ToolRegistry。”

```text
register-chat-ipc 收到文本
→ buildSkillCatalog 生成精简目录
→ 目录与人格、记忆一起组成 System Prompt
→ DeepSeek 看到 Tutor 的描述与问题匹配
→ 返回 invoke_skill({skill_id: "agent-learning-tutor"})
→ Tool Agent 在 ToolRegistry 中找到 invoke_skill
→ SkillRegistry.readBody() 安全读取正文
→ 正文作为 role=tool 消息返回给模型
→ 模型按照正文调用 search_knowledge
→ 检索结果再次作为 role=tool 返回模型
→ 模型生成最终教学回答
```

Catalog 只包含 ID、描述和所需工具，不包含正文、Reference 或本地路径。这种方式叫 progressive disclosure（渐进式披露或渐进加载）。

## 7. 手动激活的完整链路

用户也可以输入：

```text
/agent-learning-tutor 解释 ToolRegistry
```

`parseSkillCommand` 只检查第一个 Token。命中已启用且可用的 ID 后：

1. 删除 `/agent-learning-tutor` 前缀。
2. 把“解释 ToolRegistry”保存成正常 user 消息。
3. 把 Skill 正文作为本轮临时 System 补充。
4. 发送 `skill_activated` 事件。

临时正文不会写进 `ChatSession`，因此下一轮仍保留之前的对话历史，但不会继续携带这次强制激活的正文。

## 8. 为什么 Meta Tool 每轮会去重

`runToolAgent` 每次开始都会创建新的 `runState`：

```ts
const runState = new Map<string, unknown>();
```

`invoke_skill` 用它记录本轮已经激活的 Skill；`read_skill_reference` 记录已经读过的 Reference。模型重复调用时只收到简短提示，不会反复把相同长文本加入上下文。

下一次用户发消息会创建新的 Agent Run 和新的 Map，因此需要时仍可重新加载。这叫 per-run isolation（按运行隔离），不是进程级全局状态。

## 9. 文件安全是怎样实现的

`skill-scanner.ts` 只扫描 Main 提供的两个固定根目录，并执行以下检查：

- ID 只允许小写字母、数字和连字符。
- `SKILL.md` 必须是普通文件。
- 拒绝符号链接和逃出根目录的真实路径。
- Frontmatter 必须满足字段类型和长度限制。
- Reference 必须来自扫描时建立的白名单。
- Renderer 不能把路径传给 Main。
- IPC 返回给 Renderer 的数据会删除 `rootPath`、`bodyPath` 和 Reference 路径。

所以 `read_skill_reference` 接收的是 `skill_id` 和白名单文件名，而不是任意 `C:/...` 路径。

## 10. 各文件的核心责任

### Main Skills

- `skill-types.ts`：定义系统中的数据形状。
- `skill-frontmatter.ts`：把 YAML + Markdown 解析成结构化数据。
- `skill-scanner.ts`：发现文件、做路径安全检查、处理用户覆盖。
- `skill-settings-store.ts`：原子保存启用状态，隔离损坏 JSON。
- `skill-registry.ts`：保存当前有效快照，负责查询和安全读取。
- `skill-catalog.ts`：生成精简 System Prompt 目录。
- `skill-tools.ts`：定义两个 Meta Tool 和每 Run 去重。
- `skill-command.ts`：解析 `/skill-id 任务`。
- `create-skill-runtime.ts`：把扫描器、设置和 Registry 组装起来。

### Electron 边界

- `register-skills-ipc.ts`：Main 中处理列表、开关和重扫。
- `ipc-channels.ts`：固定三条 Skills Channel。
- `electron-api.ts`：规定 Renderer 能调用的方法类型。
- `preload/index.ts`：把固定调用包装成 `window.cyrene.skills`。
- `skills-view.ts`：渲染列表并处理交互。
- `skills-view-model.ts`：不依赖 DOM 的排序和状态文案。

## 11. 三条 IPC Channel

```text
cyrene:skills:list
cyrene:skills:set-enabled
cyrene:skills:reload
```

`set-enabled` 只接受：

```ts
{ id: "agent-learning-tutor", enabled: false }
```

Main 会再次检查对象原型、字段数量、ID 格式和布尔类型。Preload 不是最终安全校验者，Main 才是权限边界。

## 12. 内置 Skill

### agent-learning-tutor

默认启用。它要求 `search_knowledge`，用于按照“通俗作用、专业名词、真实调用链、Python 类比”的顺序讲解当前项目。

### cyrene-original-voice

默认禁用。用户可在 Skills 页面开启。它只调整文字表达方式，不包含语音、通话或音频功能；九份场景 Reference 按需读取。

## 13. 如何测试

运行 Skills 单元测试：

```powershell
npx.cmd vitest run tests/skills tests/main/register-skills-ipc.test.ts tests/renderer/skills-view.test.ts tests/resources/skills-resources.test.ts
```

运行完整验收：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev:electron
```

界面测试步骤：

1. 打开 `Skills` 标签，应看到两个内置 Skill。
2. Tutor 应为 Enabled，Original Voice 应为 Disabled。
3. 切换开关后关闭并重新启动，状态应保留。
4. 点击 Reload，应重新扫描固定目录。
5. 在聊天中输入 `/agent-learning-tutor 解释 ToolRegistry`，事件栏应出现 `Skill activated`。
6. 普通提问项目架构时，模型可以自行调用 `invoke_skill`。

## 14. 目前有意不做的能力

Phase 8 不执行 Skill 自带脚本，不在线下载 Skill，不注册 MCP Server，也不允许 Skill 修改自己。未来即使增加这些功能，也应通过受控 Tool 和权限确认实现，而不是让 Markdown 文件自动获得 Node.js 权限。
