# 代码分析

> 王总怎么分析项目代码？

---

## 🔍 代码索引服务

本地运行的代码分析服务，支持：
- **调用图查询** - 谁调用了这个函数？这个函数调用了谁？
- **类型继承** - 子类/父类关系
- **装饰器索引** - 快速找 RPC/Controller 等
- **关键词搜索** - 在代码摘要中搜索

---

## ⚡ 常用查询

### 调用关系

```bash
# 谁调用了这个函数
curl "http://127.0.0.1:18801/graph/callers?name=函数名"

# 这个函数调用了谁
curl "http://127.0.0.1:18801/graph/callees?name=函数名"

# 两点间的调用路径
curl "http://127.0.0.1:18801/graph/path?from=起点&to=终点"
```

### 影响范围分析

```bash
# 改了这个函数会影响谁（向上追溯调用链）
curl "http://127.0.0.1:18801/graph/impact?name=函数名&depth=3"

# 循环依赖检测
curl "http://127.0.0.1:18801/graph/cycles?limit=10"
```

### 类型继承

```bash
# 子类
curl "http://127.0.0.1:18801/graph/children?name=ServerResp"

# 父类
curl "http://127.0.0.1:18801/graph/parents?name=类名"
```

### 装饰器索引

```bash
# 所有 RPC 端点（915个）
curl "http://127.0.0.1:18801/graph/rpc-endpoints?limit=50"

# 所有 Controller（141个）
curl "http://127.0.0.1:18801/graph/controllers"

# 某装饰器标注的所有目标
curl "http://127.0.0.1:18801/graph/decorator-targets?name=Validate"
```

### 模块依赖

```bash
# 模块依赖分析
curl "http://127.0.0.1:18801/graph/module-deps?module=src/bingo/campaign"
```

### 关键词搜索

```bash
# 在代码摘要中搜索
curl "http://127.0.0.1:18801/search?q=rescue&p=bf-nakama-ts"
```

---

## 📊 已索引项目

| 项目 | 摘要数 | 说明 |
|------|--------|------|
| bf-nakama-ts | 3849 | BF 后端 TypeScript |
| bf-nakama-lua | 3849 | BF 后端 Lua |
| clawdbot | 11603 | Clawdbot 源码 |

---

## 💡 使用场景

| 场景 | 用法 |
|------|------|
| **理解函数作用** | 查调用关系 + 读代码 |
| **评估修改影响** | `/graph/impact` 向上追溯 |
| **找 RPC 入口** | `/graph/rpc-endpoints` |
| **分析循环依赖** | `/graph/cycles` |
| **追踪数据流** | `/graph/path` 找链路 |

---

## 🔗 相关

```
/helper rag      → 知识库搜索
/helper analyze  → 日志分析
```
