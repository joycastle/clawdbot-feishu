# 多维表格

> 读取飞书多维表格 (Bitable) 数据

**端口：** `localhost:18795`

---

## 常用操作

| 说法 | 我会做什么 |
|------|-----------|
| 读一下这个多维表格 | 解析 URL，获取记录 |
| 帮我查第 3 条 | 按编号查找 |

---

## URL 识别

看到这种链接就是多维表格：
```
https://xxx.feishu.cn/base/xxxtoken?table=tblxxx
```

---

## 读取方式

**方式一：统一入口（推荐）**
```bash
curl "http://127.0.0.1:18798/read?url=<飞书多维表格URL>"
```

**方式二：直接调用**
```bash
# 列出表
curl "http://127.0.0.1:18795/tables?appToken=xxx"

# 获取记录
curl "http://127.0.0.1:18795/records?appToken=xxx&tableId=tblxxx"
```

---

## 视频分析场景

多维表格里的视频附件 → 下载 → GCS 中转 → Gemini 分析

详见 `/helper video`

---

## 详细文档

- `memory/tools/feishu-docs.md`
