# 代码索引工具包

一套通用的 TypeScript 代码索引工具，可以为任何 TypeScript 项目生成代码智能分析数据库。

## 快速开始

```bash
cd ~/clawd/scripts/code-index

# 1. 安装依赖（首次使用）
npm install

# 2. 索引新项目
./index-project.sh <项目名> <项目路径>

# 示例
./index-project.sh my-project ~/work/my-project/src
```

## 索引流程

```
┌─────────────────┐
│  TypeScript     │
│  源代码目录      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: extract-call-graph.ts                                   │
│  提取函数/类/方法定义 + 调用关系                                   │
│  → nodes 表 + edges 表                                           │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: extract-inheritance.ts                                  │
│  提取 extends/implements 继承关系                                 │
│  → inheritance 表                                                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: extract-decorators.ts                                   │
│  提取装饰器元数据 (@Rpc, @Controller 等)                          │
│  → decorators 表                                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: extract-summaries.ts                                    │
│  生成函数摘要 JSONL (供全文搜索)                                   │
│  → <项目名>.jsonl                                                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: register-project (curl API)                             │
│  注册项目到 code-index-api 服务                                   │
│  → projects.json                                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  可通过 18801   │
│  端口查询       │
└─────────────────┘
```

## 生成的数据库结构

### SQLite 表

| 表名 | 内容 | 字段 |
|------|------|------|
| `nodes` | 函数/类/方法定义 | file, name, type, start_line, end_line, exported |
| `edges` | 调用关系 | caller_file, caller_name, callee_name, line |
| `inheritance` | 继承关系 | child_name, parent_name, relation (extends/implements) |
| `decorators` | 装饰器 | target_name, decorator_name, decorator_args |

### JSONL 摘要文件

每行一个 JSON 对象，包含：
- type: class/function/method
- name: 名称
- file: 文件路径
- line: 行号
- signature: 函数签名
- doc: 文档注释
- calls: 调用的函数列表

## API 端点 (18801)

索引完成后，可通过以下 API 查询：

```bash
# 搜索函数
curl "http://127.0.0.1:18801/search?q=login&p=my-project"

# 谁调用了这个函数
curl "http://127.0.0.1:18801/graph/callers?name=handleLogin&p=my-project"

# 这个函数调用了谁
curl "http://127.0.0.1:18801/graph/callees?name=handleLogin&p=my-project"

# 调用链追踪
curl "http://127.0.0.1:18801/graph/path?from=main&to=save&p=my-project"

# 影响范围分析
curl "http://127.0.0.1:18801/graph/impact?name=validateUser&depth=3&p=my-project"

# 查子类
curl "http://127.0.0.1:18801/graph/children?name=BaseService&p=my-project"

# 查装饰器使用
curl "http://127.0.0.1:18801/graph/decorator-targets?name=Rpc&p=my-project"
```

详细 API 文档见 `~/clawd/memory/tools/code-index-api.md`

## 目录结构

```
~/clawd/scripts/code-index/
├── README.md                  # 本文档
├── package.json               # 依赖
├── index-project.sh           # 一键索引脚本
├── extract-call-graph.ts      # 提取调用图
├── extract-inheritance.ts     # 提取继承关系
├── extract-decorators.ts      # 提取装饰器
└── extract-summaries.ts       # 生成摘要 JSONL
```

## 手动执行步骤

如果需要单独执行某一步：

```bash
cd ~/clawd/scripts/code-index

# 设置环境变量
export PROJECT_NAME=my-project
export PROJECT_ROOT=/path/to/src
export DB_PATH=~/.clawdbot/extensions/feishu/data/code-index/${PROJECT_NAME}-call-graph.db
export JSONL_PATH=~/.clawdbot/extensions/feishu/data/code-index/${PROJECT_NAME}.jsonl

# 逐步执行
npx tsx extract-call-graph.ts
npx tsx extract-inheritance.ts
npx tsx extract-decorators.ts
npx tsx extract-summaries.ts > $JSONL_PATH

# 注册项目
curl -X POST http://127.0.0.1:18801/index -H "Content-Type: application/json" -d '{
  "name": "'$PROJECT_NAME'",
  "path": "'$PROJECT_ROOT'",
  "summariesPath": "'$JSONL_PATH'"
}'
```

## 注意事项

1. **tsconfig.json 必须存在** - 工具依赖 TypeScript 项目配置
2. **路径要用绝对路径** - 相对路径可能导致问题
3. **首次索引较慢** - 大项目可能需要几分钟
4. **增量更新暂不支持** - 每次都是全量重建

## 已索引项目

| 项目 | 路径 | 数据库 | 摘要数 |
|------|------|--------|--------|
| bf-nakama-ts | ~/work/bf/nakama-ts/src | call-graph.db | 3849 |
| clawdbot | ~/work/clawdbot/src | clawdbot-call-graph.db | 11603 |
