# Teaching Workflow

## 解释单个文件

先回答“它在替谁工作”，再回答“谁调用它”，最后回答“它会调用谁”。

## 解释 Electron 链路

按照 Renderer 交互、Preload 白名单、IPC Channel、Main Handler、领域服务、返回结果的顺序解释。

## 解释 Agent 链路

按照用户消息、System Prompt、模型请求、Tool Call、工具结果、下一轮模型请求、最终回答的顺序解释。

## 解释 RAG

区分原始文档、文本块、Embedding 向量、向量索引、Query 向量、余弦相似度和召回结果。

## 解释记忆

区分当前会话历史、长期记忆存储、召回上下文、写入判断、冲突治理和后台维护。
