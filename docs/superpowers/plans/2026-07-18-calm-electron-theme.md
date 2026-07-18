# Calm Electron Workspace Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Electron renderer 改造成已确认的 Calm Workspace 布局，同时完整保留现有业务交互。

**Architecture:** 继续使用现有原生 HTML、TypeScript 和 CSS，不引入 UI 框架。`index.html` 负责稳定应用外壳，`main.ts` 负责页面导航和 Activity 抽屉状态，现有各 `*-view.ts` 继续负责各自业务视图，`style.css` 统一视觉系统和响应式行为。

**Tech Stack:** Electron、TypeScript、Vite、原生 DOM/CSS、Vitest

**Execution status:** Completed on 2026-07-18. Full test suite, typecheck, build, Electron smoke test, and narrow-window screenshots verified.

## Global Constraints

- 不改变 main、preload 和 IPC 业务协议。
- 不重构 Agent、RAG、Memory、Skills、MCP、Scheduler 或 Runs 业务逻辑。
- Activity 默认收起，并在窄窗口中以覆盖式抽屉显示。
- Chat 使用宽松阅读布局，数据页面使用紧凑管理布局。
- 所有主要控件必须具备可读标签、键盘焦点和稳定尺寸。

---

### Task 1: 稳定应用外壳与左侧导航

**Files:**
- Modify: `src/renderer/chat/index.html`
- Modify: `src/renderer/chat/main.ts`
- Test: `tests/renderer/workspace-shell.test.ts`

**Interfaces:**
- Consumes: 现有视图按钮 ID 和 `setActiveView()` 页面切换逻辑。
- Produces: `.app-sidebar`、`.page-header`、`#activity-toggle` 和现有业务视图容器。

- [ ] 编写文件结构测试，检查左侧导航、顶部栏、Activity 按钮和抽屉元素存在。
- [ ] 运行 `npx vitest run tests/renderer/workspace-shell.test.ts`，确认旧结构不能满足测试。
- [ ] 重排 `index.html`，保留所有被 TypeScript 使用的现有 ID。
- [ ] 扩展 `setActiveView()`，同步页面标题、导航选中状态和 `aria-current`。
- [ ] 再次运行结构测试并提交。

### Task 2: Activity 抽屉行为

**Files:**
- Create: `src/renderer/chat/activity-drawer.ts`
- Modify: `src/renderer/chat/main.ts`
- Test: `tests/renderer/activity-drawer.test.ts`

**Interfaces:**
- Consumes: toggle 按钮、drawer 元素、close 按钮。
- Produces: `createActivityDrawer(options)`，提供 `open()`、`close()`、`toggle()` 和 `setAttention(boolean)`。

- [ ] 编写基于最小 DOM 替身的抽屉状态测试。
- [ ] 运行测试，确认模块尚不存在。
- [ ] 实现抽屉控制器，并维护 `hidden`、`aria-expanded`、`aria-hidden` 和注意状态。
- [ ] 在 `main.ts` 中接入；错误事件设置注意状态，用户打开抽屉后清除。
- [ ] 运行抽屉和 renderer 测试并提交。

### Task 3: Calm Workspace 视觉系统

**Files:**
- Modify: `src/renderer/chat/style.css`
- Test: `tests/renderer/workspace-shell.test.ts`

**Interfaces:**
- Consumes: Task 1 确定的语义类名和各业务视图现有类名。
- Produces: 颜色、字体、间距、边框、按钮、输入框、消息和数据页面统一样式。

- [ ] 扩展静态测试，检查主题变量、固定导航、sticky 顶栏和 drawer 状态选择器。
- [ ] 使用 CSS 自定义属性定义中性色、绿色强调色和状态色。
- [ ] 实现桌面应用网格、Chat 居中消息流、底部 composer 和紧凑数据页面。
- [ ] 统一现有 Memory、Skills、MCP、Tasks、Runs 控件和状态样式。
- [ ] 添加 1100px、860px 两级响应式规则和清晰的 `:focus-visible`。
- [ ] 运行 renderer 测试并提交。

### Task 4: 功能与视觉回归验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-calm-electron-theme.md`

**Interfaces:**
- Consumes: 完成后的 renderer。
- Produces: 构建、测试和截图验证记录。

- [ ] 运行 `npm test`。
- [ ] 运行 `npm run build` 和 `npm run typecheck`。
- [ ] 运行 `npm run test:electron-smoke`。
- [ ] 启动 Electron，分别以宽窗口和窄窗口检查 Chat、Memory、MCP、Tasks、Runs 与 Activity。
- [ ] 修复检查中发现的裁切、重叠或状态问题。
- [ ] 在本计划勾选完成项并提交最终结果。
