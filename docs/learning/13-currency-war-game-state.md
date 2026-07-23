# 13：货币战争独立多对局系统

## 1. 当前功能

货币战争页面现在独立管理对局，不再与 Conversation 绑定。用户最多可创建 10 份对局，至少会保留一份，并可进行选择、新建、重命名、删除、重置和自动保存。

每份 GameState 记录：

- 固定的 4.4、标准博弈、最高难度；
- 当前节点、生命、金币、等级、经验和连胜；
- 上阵与备战角色，以及角色实际费用、星级和位置；
- 商店角色，商店只允许 1 星或 2 星；
- 装备库存数量与分配数量；
- 投资环境、各位面投资策略、已解锁顾问和备注。

上阵人数不再由等级直接限制，因为实际玩法还可能受到其他机制影响。旧版“特殊资源”字段已经删除。

## 2. 结构关系

```text
Renderer 对局页面
    ↓ window.cyrene.currencyWarGames
Preload（只暴露固定方法）
    ↓ 11 个 IPC Channel
register-currency-war-games-ipc.ts
    ↓
CurrencyWarGameService（业务规则）
    ↓
CurrencyWarGameStore（index.json + sessions/*.json）
```

`CurrencyWarGameStore` 负责文件保存、活动对局 ID、写入排队和损坏文件隔离。`CurrencyWarGameService` 负责 10 局上限、名称规则、校验、编辑选项和摘要生成。

数据目录是 Electron `userData/currency-war/games`。旧的 Conversation GameState 目录不会被新系统读取、迁移或删除。

## 3. 对局与聊天的关系

对局和聊天完全独立：

- 切换、创建、重命名或删除 Conversation 不会改变对局；
- 删除 Conversation 不会删除对局；
- Chat 的 system prompt 不会自动包含 GameState；
- Agent 不会在用户没有明确提供状态时假装知道当前对局。

需要咨询 Agent 时，先在对局页面点击“总结并复制”。程序会用确定性 TypeScript 代码生成摘要，不调用 LLM。用户可以把摘要粘贴到任意 Conversation 中。

这种设计让数据流可见：Agent 只看到用户主动粘贴的内容，不存在隐藏注入。

## 4. 费用、星级与装备规则

角色实例保存实际选中的 `cost`，而不是每次根据角色名称重新猜测费用。因此银狼 LV.999 可以分别保存为 3、4、5 费，普通角色只能使用数据表中属于自己的费用。

阵容角色允许 1 至 3 星，商店角色只允许 1 至 2 星。

装备库存与分配都保存正整数 `quantity`。同一库存项可以拆分给多个角色，但分配总数不能超过库存数量；每个角色获得的装备总数不能超过 3。

## 5. 如何测试

```bash
npm test
npm run typecheck
npm run build
npm run currency-war:data-check
npm run dev:electron
```

手动检查：

1. 创建多份对局并在它们之间切换，状态应彼此独立。
2. 创建到 10 份后，“新建”按钮应禁用。
3. 银狼 LV.999 分别选择 3、4、5 费，保存和重新切换后费用不变。
4. 商店星级只有 1、2。
5. 装备库存和分配可以填写数量，非法总量不能保存。
6. 点击“总结并复制”，摘要应显示角色费用和装备数量。
7. 切换 Conversation，对局不应跟着变化。
