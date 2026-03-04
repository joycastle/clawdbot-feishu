# 代码索引 Onboarding 标准流程

## 概述

当有新项目需要接入代码智能分析时，按以下标准流程处理。

## 前置条件

1. **项目必须是 TypeScript** - 工具基于 ts-morph
2. **有 tsconfig.json** - 在源代码目录下
3. **code-index-api 服务运行中** - 端口 18801

## 一键索引（推荐）

```bash
~/clawd/scripts/code-index/index-project.sh <项目名> <项目路径>

# 示例
~/clawd/scripts/code-index/index-project.sh my-backend ~/work/my-project/src
```

脚本会自动完成以下步骤：
1. 提取调用图 → nodes + edges 表
2. 提取继承关系 → inheritance 表
3. 提取装饰器 → decorators 表
4. 生成摘要 JSONL → 全文搜索
5. 注册到 API 服务

## 输出文件

| 文件 | 位置 | 用途 |
|------|------|------|
| `<项目名>-call-graph.db` | `~/.clawdbot/extensions/feishu/data/code-index/` | SQLite 图数据库 |
| `<项目名>.jsonl` | 同上 | 函数摘要（全文搜索） |

## 数据库表结构

### nodes（函数/类/方法）
```sql
file TEXT, name TEXT, type TEXT, start_line INT, end_line INT, exported INT
```

### edges（调用关系）
```sql
caller_file TEXT, caller_name TEXT, callee_name TEXT, line INT
```

### inheritance（继承）
```sql
child_name TEXT, parent_name TEXT, relation TEXT (extends/implements)
```

### decorators（装饰器）
```sql
target_name TEXT, decorator_name TEXT, decorator_args TEXT
```

## API 使用示例

```bash
# 搜索
curl "http://127.0.0.1:18801/search?q=login&p=<项目名>"

# 谁调用了
curl "http://127.0.0.1:18801/graph/callers?name=handleLogin&p=<项目名>"

# 调用了谁
curl "http://127.0.0.1:18801/graph/callees?name=handleLogin&p=<项目名>"

# 调用链
curl "http://127.0.0.1:18801/graph/path?from=main&to=save&p=<项目名>"

# 影响范围
curl "http://127.0.0.1:18801/graph/impact?name=validate&depth=3&p=<项目名>"

# 子类
curl "http://127.0.0.1:18801/graph/children?name=BaseService&p=<项目名>"

# 装饰器使用
curl "http://127.0.0.1:18801/graph/decorator-targets?name=Rpc&p=<项目名>"

# 列出所有图数据库项目
curl "http://127.0.0.1:18801/graph-projects"
```

## 手动步骤（调试用）

```bash
cd ~/clawd/scripts/code-index

# 设置环境变量
export PROJECT_NAME=my-project
export PROJECT_ROOT=/path/to/src
export DB_PATH=~/.clawdbot/extensions/feishu/data/code-index/${PROJECT_NAME}-call-graph.db
export JSONL_PATH=~/.clawdbot/extensions/feishu/data/code-index/${PROJECT_NAME}.jsonl

# 逐步执行
npx tsx extract-call-graph.ts     # ~2-5分钟（大项目）
npx tsx extract-inheritance.ts    # ~30秒
npx tsx extract-decorators.ts     # ~30秒
npx tsx extract-summaries.ts > $JSONL_PATH  # ~1分钟

# 注册
curl -X POST http://127.0.0.1:18801/index -H "Content-Type: application/json" \
  -d '{"name":"'$PROJECT_NAME'","path":"'$PROJECT_ROOT'","summariesPath":"'$JSONL_PATH'"}'
```

## 常见问题

### Q: 索引后查不到？
A: 确认 `p=<项目名>` 参数正确，或检查 `curl http://127.0.0.1:18801/graph-projects`

### Q: 增量更新？
A: 暂不支持，每次全量重建。大项目约 2-5 分钟。

### Q: JavaScript 项目？
A: 不支持，仅 TypeScript。

### Q: 想只索引部分目录？
A: 修改 `extract-*.ts` 中的 glob pattern。

## 已索引项目

| 项目 | 路径 | 节点 | 边 | 继承 | 装饰器 |
|------|------|------|-----|------|--------|
| bf-nakama-ts | ~/work/bf/nakama-ts/src | 14843 | 56917 | 2484 | 5111 |
| clawdbot | ~/work/clawdbot/src | 11967 | 81750 | - | - |

## 相关文档

- API 详细文档：`memory/tools/code-index-api.md`
- 工具包源码：`~/clawd/scripts/code-index/`
- 服务源码：`~/.clawdbot/extensions/feishu/src/services/code-index-api.ts`
