# Phase 8 Skills 系统实施计划

> **执行要求：** 使用 executing-plans 在当前会话逐项执行；每个功能遵循 TDD，先看到测试因缺少行为而失败，再写最小实现。

**目标：** 为 Electron Agent 增加安全的本地 Skills 系统，实现扫描、渐进加载、手动激活、状态管理界面和两项内置 Skill。

**架构：** Main 进程持有一个通过依赖注入共享的 `SkillRegistry`。System Prompt 只注入精简 Catalog，正文和参考资料通过 ToolRegistry 中的 Meta Tools 按需读取；Renderer 只能经固定 IPC 管理启用状态，不能传入文件路径。

**技术栈：** TypeScript、Node.js `fs/promises`、gray-matter/YAML、Electron IPC、Vitest、Vite。

## 全局约束

- 不使用 Subagent。
- Skill 只提供指令，不授予新工具或文件权限。
- 用户 Skill 可按目录 ID 整体覆盖内置 Skill，不做字段合并。
- Skill ID 必须匹配 `^[a-z0-9][a-z0-9-]*$`。
- 描述最多 500 字符，正文和单个 Reference 最多 16,000 字符，每项最多 32 个 Reference，Catalog 最多 100 项。
- 只扫描固定内置目录和 `<userData>/skills`；拒绝绝对路径、`..`、越界真实路径和符号链接。
- `defaultEnabled` 省略时为 `true`；用户设置优先于默认值。
- 不实现脚本执行、MCP、在线市场、Git 下载或 Skill 自修改。

---

### Task 1：结构化解析与扫描

**文件：**
- 创建：`src/main/skills/skill-types.ts`
- 创建：`src/main/skills/skill-frontmatter.ts`
- 创建：`src/main/skills/skill-scanner.ts`
- 测试：`tests/skills/skill-frontmatter.test.ts`
- 测试：`tests/skills/skill-scanner.test.ts`
- 修改：`package.json`、`package-lock.json`

**接口：**
- `parseSkillDocument(content, context): ParsedSkillDocument`
- `scanSkillRoots({ builtinRoot, userRoot }): Promise<SkillScanResult>`

- [x] 编写解析合法字段、非法类型、重复工具、长度限制的失败测试。
- [x] 运行 `npx vitest run tests/skills/skill-frontmatter.test.ts`，确认因模块缺失失败。
- [x] 安装 `gray-matter` 并实现结构化 Frontmatter 解析。
- [x] 编写双目录覆盖、诊断、Reference 白名单和路径逃逸的失败测试。
- [x] 运行 `npx vitest run tests/skills/skill-scanner.test.ts`，确认扫描器缺失。
- [x] 实现异步扫描、安全路径校验和结构化诊断。
- [x] 运行两项测试并确认通过。

### Task 2：Registry、设置与 Catalog

**文件：**
- 创建：`src/main/skills/skill-settings-store.ts`
- 创建：`src/main/skills/skill-registry.ts`
- 创建：`src/main/skills/skill-catalog.ts`
- 测试：`tests/skills/skill-settings-store.test.ts`
- 测试：`tests/skills/skill-registry.test.ts`
- 测试：`tests/skills/skill-catalog.test.ts`

**接口：**
- `createSkillSettingsStore(filePath)` 提供 `load()` 与 `save()`。
- `SkillRegistry.initialize()`、`reload()`、`list()`、`setEnabled()`、`readBody()`、`readReference()`、`snapshot()`。
- `buildSkillCatalog(entries): string`。

- [x] 先写设置损坏恢复、原子写入和状态覆盖测试并观察失败。
- [x] 实现设置存储与损坏文件隔离。
- [x] 先写 Registry 快照替换、工具可用性、缓存和白名单读取测试并观察失败。
- [x] 实现 Registry，重新扫描失败时保留旧快照。
- [x] 先写 Catalog 过滤和 100 项上限测试并观察失败。
- [x] 实现只含 ID、描述和工具需求的 Catalog。
- [x] 运行 Task 2 全部测试。

### Task 3：渐进加载工具、命令与事件

**文件：**
- 创建：`src/main/skills/skill-tools.ts`
- 创建：`src/main/skills/skill-command.ts`
- 修改：`src/main/tools/tool-types.ts`
- 修改：`src/main/agent/tool-agent.ts`
- 修改：`src/main/agent/agent-events.ts`
- 修改：`src/renderer/chat/renderer-events.ts`
- 测试：`tests/skills/skill-tools.test.ts`
- 测试：`tests/skills/skill-command.test.ts`
- 修改测试：`tests/agent/agent-events.test.ts`、`tests/renderer/renderer-events.test.ts`

**接口：**
- `registerSkillTools(toolRegistry, skillRegistry)` 注册 `invoke_skill` 和 `read_skill_reference`。
- `parseSkillCommand(text, registrySnapshot)` 返回手动激活结果或普通文本。
- `ToolExecutionContext` 提供每次 Agent Run 独立状态和事件回调。

- [x] 先写 Meta Tool 成功、错误、每 Run 去重和 Reference 白名单测试并观察失败。
- [x] 扩展工具执行上下文并实现两个 Meta Tool。
- [x] 先写 `/skill-id 任务`、未知命令和空任务测试并观察失败。
- [x] 实现手动命令解析。
- [x] 先写三个 Skill 领域事件的终端和 Renderer 格式测试并观察失败。
- [x] 实现 `skill_activated`、`skill_reference_loaded`、`skill_load_failed`。
- [x] 运行 Task 3 及 Agent 回归测试。

### Task 4：接入聊天工作流

**文件：**
- 修改：`src/main/app/register-chat-ipc.ts`
- 修改：`src/main/runtime/agent-runtime.ts`
- 修改：`src/cli/chat.ts`
- 测试：`tests/main/register-chat-ipc.test.ts`
- 测试：`tests/runtime/agent-runtime.test.ts`

**接口：**
- Chat IPC 接收共享 `SkillRegistry`，每轮把 Catalog 追加到人格 Prompt。
- 手动激活正文仅作为本轮临时 System 补充，不写进 `ChatSession`。
- Runtime ToolRegistry 在存在 SkillRegistry 时注册 Meta Tools。

- [x] 先写 Catalog 注入、自动工具存在、手动正文注入、命令不进入历史和空任务拒绝测试并观察失败。
- [x] 实现 Prompt 组合与手动激活流程。
- [x] 让 CLI 使用相同 Catalog 和 Meta Tools。
- [x] 运行聊天、Runtime、CLI 相关回归测试。

### Task 5：设置 IPC 与 Preload API

**文件：**
- 创建：`src/shared/skill-api-types.ts`
- 创建：`src/main/app/register-skills-ipc.ts`
- 修改：`src/shared/ipc-channels.ts`
- 修改：`src/shared/electron-api.ts`
- 修改：`src/preload/index.ts`
- 测试：`tests/main/register-skills-ipc.test.ts`
- 修改测试：`tests/shared/ipc-channels.test.ts`、`tests/shared/electron-api.test.ts`

**接口：**
- Channel：`cyrene:skills:list`、`cyrene:skills:set-enabled`、`cyrene:skills:reload`。
- Preload：`window.cyrene.skills.list()`、`setEnabled(id, enabled)`、`reload()`。

- [x] 先写固定 Channel、Payload 校验、Handler 替换和关闭测试并观察失败。
- [x] 实现 Skills IPC，Main 再次校验 ID 和布尔值。
- [x] 先写 Electron API 类型及 Preload 映射测试并观察失败。
- [x] 扩展共享类型和 Preload。
- [x] 运行 Task 5 测试。

### Task 6：Main 生命周期集成

**文件：**
- 创建：`src/main/skills/create-skill-runtime.ts`
- 修改：`src/main/app/main.ts`
- 测试：`tests/skills/create-skill-runtime.test.ts`

**接口：**
- `createSkillRuntime({ builtinRoot, userRoot, settingsPath, toolIds })` 初始化共享 Registry。
- Main 将同一 Registry 注入 Chat IPC、Skills IPC 和 Runtime ToolRegistry。

- [x] 先写目录、默认状态和工具可用性初始化测试并观察失败。
- [x] 实现运行时工厂和开发/打包资源路径选择。
- [x] 在 Main 启动时初始化并在关闭流程中注销 Skills IPC。
- [x] 运行 Task 6 与 Main 回归测试。

### Task 7：Renderer Skills 管理视图

**文件：**
- 创建：`src/renderer/chat/skills-view-model.ts`
- 创建：`src/renderer/chat/skills-view.ts`
- 修改：`src/renderer/chat/index.html`
- 修改：`src/renderer/chat/main.ts`
- 修改：`src/renderer/chat/style.css`
- 测试：`tests/renderer/skills-view-model.test.ts`
- 测试：`tests/renderer/skills-view.test.ts`

**接口：**
- `mountSkillsView({ root, api })` 返回具有 `show()` 的控制器。
- 视图展示来源、状态、工具、Reference 和诊断；只提供开关与重扫按钮。

- [x] 先写排序、状态文案和不可用原因模型测试并观察失败。
- [x] 实现纯 ViewModel。
- [x] 先写挂载、加载、切换、重扫和错误状态 DOM 测试并观察失败。
- [x] 实现 Skills 视图并接入第三个顶部标签。
- [x] 添加响应式样式，保证无嵌套卡片和文本溢出。
- [x] 运行 Renderer 全部测试和 Vite 构建。

### Task 8：内置 Skills、学习文档与验收

**文件：**
- 创建：`resources/skills/agent-learning-tutor/SKILL.md`
- 创建：`resources/skills/agent-learning-tutor/references/workflow.md`
- 创建：`resources/skills/cyrene-original-voice/SKILL.md`
- 复制：`resources/cyrene/inactive-skills/cyrene-original-voice/references/*` 到内置 Skill References
- 创建：`docs/learning/phase-08-skills-system.zh-CN.md`
- 修改：`docs/learning/00-overall-replica-roadmap.zh-CN.md`
- 修改：`README.md`
- 测试：`tests/resources/skills-resources.test.ts`

**接口：**
- `agent-learning-tutor` 默认启用并要求 `search_knowledge`。
- `cyrene-original-voice` 默认禁用且不声明语音、通话或脚本能力。

- [x] 先写两个资源可扫描、默认状态和 Reference 限制测试并观察失败。
- [x] 添加内置 Skill 正文与 References。
- [x] 编写中文学习文档，解释 Skill、Prompt、Tool、IPC、MCP 的区别和完整调用链。
- [x] 更新路线图和 README 的运行/测试说明。
- [x] 运行 `npm test`、`npm run typecheck`、`npm run build`。
- [x] 启动 Electron 做真实界面冒烟测试，并检查聊天、Skills 列表、开关、重扫和事件。
- [x] 检查 `git diff --check` 与设计逐条覆盖情况后提交并推送 `main`。
