# feishu-project/ - 飞书项目 SDK

封装飞书项目（Lark Project）API 的客户端，供 `services/project-api.ts` 使用。

## 目录结构

```
feishu-project/
├── api/              # 各模块 API 实现
│   ├── base.ts       # 基础请求封装
│   ├── project.ts    # 项目操作
│   ├── workitem.ts   # 工作项操作
│   ├── workflow.ts   # 工作流操作
│   ├── subtask.ts    # 子任务操作
│   ├── relation.ts   # 关联关系
│   ├── manhour.ts    # 工时记录
│   ├── field.ts      # 字段操作
│   ├── template.ts   # 模板操作
│   ├── comment.ts    # 评论操作
│   └── types.ts      # 类型定义
├── client.ts         # 客户端主类
├── instance.ts       # 单例实例
├── types.ts          # 对外类型
└── index.ts          # 导出入口
```

## 使用方式

这个 SDK 不直接被 Agent 调用，而是被 `services/project-api.ts` 使用来暴露 HTTP 接口。

Agent 应该通过 HTTP 调用：

```bash
curl http://127.0.0.1:18793/workitems?typeKey=issue
```

## 相关文档

- 实战指南：`memory/feishu-project-api-guide.md`
- 类型和字段：`memory/feishu-project-schema.md`
- User Key 表：`memory/feishu-project-userkeys.md`
