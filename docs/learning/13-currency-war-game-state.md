# 13：货币战争 GameState

## 1. 这一阶段解决了什么

之前项目虽然有货币战争的 4.4 数据和固定节点规则，但 Agent 不知道玩家这一局当前处于什么状态。

现在每个会话都有一份独立 GameState，用于记录当前节点、经济、阵容、商店、装备、投资、顾问、特殊资源和备注。当前只支持标准博弈、最高难度和 4.4 数据。

## 2. 数据经过了哪些层

```text
对局页面
  ↓ window.cyrene.currencyWarState
preload 固定 API
  ↓ currency-war:state:* IPC
主进程 Handler
  ↓
GameState Service（规则、校验、Agent 上下文）
  ↓
GameState Store（JSON、原子写入、写队列）
```

Renderer 不能直接读写文件，只能调用 preload 暴露的 `get/create/update/reset/validate`。

## 3. 为什么每个 Conversation 独立

GameState 文件名使用 Conversation ID：

```text
userData/
  currency-war/
    game-states/
      conv_xxx.json
      conv_yyy.json
```

切换会话时，界面先保存上一局，再加载目标会话。删除会话时也会删除对应 GameState。

## 4. 自动保存如何工作

修改表单后，Renderer 先更新内存状态并显示“待保存”。600 毫秒内继续修改会重新计时，停止编辑后才发送一次 IPC。

Store 对同一会话的写入排队，并用“临时文件 → 重命名”原子替换正式文件。如果校验失败，Service 不写盘，页面保留输入并显示具体错误。

## 5. Agent 如何看到当前对局

每次持久会话发消息时，`register-chat-ipc.ts` 调用：

```ts
currencyWarStateService.getAgentContext(conversationId)
```

生成的紧凑上下文包含版本、模式、节点、下一节点、经济、阵容和投资等信息。它只加入当前请求的 system prompt，不保存为消息、不直接写入长期记忆，模型也不能直接修改 GameState。

## 6. 如何手动录入

阵容和商店不再要求输入特殊文本格式。

新增上阵角色、备战角色或商店槽位后，依次选择：

```text
费用 → 角色 → 当前星级
```

角色下拉框只显示所选费用对应的角色。上阵角色还可以选择前台或后台。

所有上阵和备战角色会获得连续序号。装备库存使用装备下拉框；装备分配直接选择“角色序号及角色名”和对应装备。内部仍通过稳定实例 ID 保存，因此序号变化不会把装备分给错误角色。

“已解锁顾问”直接选择顾问角色；选择“未解锁”即可清空，不再单独勾选解锁状态。

投资策略仍使用轻量文本：

```text
1 | 策略名称
2 | 策略名称
```

## 7. 推荐测试步骤

1. 运行 `npm run dev:electron`。
2. 打开“对局”，修改金币并等待“已保存”。
3. 切换会话，确认每个会话的对局相互独立。
4. 重启应用，确认数据恢复。
5. 将等级改成小于上阵人数，确认出现校验问题。
6. 回到 Chat，询问“根据当前节点和阵容，我下一步应该做什么？”。
7. 检查 Agent 是否正确读取节点、经济和阵容后再给建议。
