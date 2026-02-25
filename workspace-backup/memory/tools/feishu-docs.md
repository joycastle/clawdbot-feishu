# 飞书文档读取方法

> 从 MEMORY.md 迁移过来，详细的技术细节

## 核心原则

**不要用 web_fetch 访问飞书文档链接！** 需要登录权限，肯定失败。

遇到 `*.feishu.cn/wiki/*`、`*.feishu.cn/docx/*`、`*.feishu.cn/sheets/*`、`*.feishu.cn/base/*` 这类链接时，用 API。

---

## 统一入口（推荐）

```bash
curl "http://127.0.0.1:18798/read?url=<飞书文档URL>"
```

支持的 URL 格式：
- wiki: `https://xxx.feishu.cn/wiki/xxxtoken`
- docx: `https://xxx.feishu.cn/docx/xxxtoken`
- sheet: `https://xxx.feishu.cn/sheets/xxxtoken`
- bitable: `https://xxx.feishu.cn/base/xxxtoken?table=tblxxx`

---

## 手动调用（了解原理）

### 1. 获取 tenant_access_token

```bash
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
Body: {"app_id":"<appId>","app_secret":"<appSecret>"}
```

appId 和 appSecret 在 clawdbot.json 的 `channels.feishu` 里。

### 2. 解析 wiki 链接

URL 格式：`https://joycastle.feishu.cn/wiki/<wiki_token>?sheet=<sheet_id>`

```bash
GET https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=<wiki_token>
Header: Authorization: Bearer <tenant_access_token>
```

返回中 `obj_token` 是实际文档 token，`obj_type` 是文档类型。

### 3. 根据类型调用对应 API

**电子表格 (sheet)**：
- 元信息：`GET /sheets/v3/spreadsheets/<obj_token>/sheets/<sheet_id>`
- 内容：`GET /sheets/v2/spreadsheets/<obj_token>/values/<sheet_id>!A1:T100`

**文档 (docx)**：
- `GET /docx/v1/documents/<obj_token>/blocks`

**多维表格 (bitable)**：
- 表列表：`GET /bitable/v1/apps/<obj_token>/tables`
- 记录：`GET /bitable/v1/apps/<obj_token>/tables/<table_id>/records`

---

## 注意事项

- token 有效期约 2 小时
- 表格中图片以 embed-image 对象返回
- 需要确保飞书应用有文档访问权限

---

*迁移自 MEMORY.md，2026-02-11*
