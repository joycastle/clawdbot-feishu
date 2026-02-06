# 飞书项目集成设计文档

## 目标
让 Agent（我）能够根据用户意图调用飞书项目 API，而不是依赖死板的文本匹配。

## 架构

```
用户消息 → Agent 理解意图 → 调用 localhost HTTP API → 飞书项目 API → 返回结果
```

类似 dev-lock-api.ts 的模式，在 localhost 上暴露 HTTP 接口供 Agent 调用。

## API 设计（localhost:18791）

### 查询类
- `GET /workitems?projectKey=xxx&typeKey=issue&assignee=xxx` - 查询工作项列表
- `GET /workitem/:id` - 查询单个工作项详情
- `GET /projects` - 获取项目列表
- `GET /types?projectKey=xxx` - 获取工作项类型
- `GET /fields?projectKey=xxx` - 获取字段定义

### 操作类
- `POST /workitem` - 创建工作项
- `PUT /workitem/:id` - 更新工作项
- `POST /workitem/:id/comment` - 添加评论
- `POST /workitem/:id/transition` - 状态流转

## 用户意图示例

| 用户说 | Agent 动作 |
|--------|-----------|
| 查一下我的待办任务 | 调用 /workitems?assignee=当前用户 |
| 帮我创建一个缺陷 | 调用 POST /workitem，收集必填信息 |
| 这个需求进展怎么样 | 解析需求 ID，调用 /workitem/:id |
| 把这个 bug 状态改成已解决 | 调用 /workitem/:id/transition |
| 给这个任务加个评论 | 调用 /workitem/:id/comment |

## 关键配置

- Project Key: `62b29e862be43458fc1ef6b2`
- Plugin ID: `MII_69855DF6DF814CC2`
- Plugin Secret: 在 clawdbot.json
- User Key: 需要根据 sender 的 open_id 映射

## User Key 映射问题

飞书项目 API 需要 `X-USER-KEY`，这是飞书项目内部的用户标识，不是 open_id。
需要建立 open_id → user_key 的映射表。

已知映射：
- 宝根: open_id=`ou_2f460687acb188f14f3c8d6af3fd30e7` → user_key=`7586496668992949190`

TODO: 如何获取其他用户的 user_key？可能需要：
1. 用户自己在飞书项目里复制（双击左下角头像）
2. 或者通过某个 API 查询

## 实现步骤

1. [x] 创建 feishu-project/ API 模块
2. [ ] 创建 feishu-project-api.ts（HTTP 服务，类似 dev-lock-api.ts）
3. [ ] 在 monitor.ts 启动该服务
4. [ ] 更新 agentPrompt 告诉我如何使用这些 API
5. [ ] 处理 user_key 映射问题
