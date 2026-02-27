# clawd-feishu

Feishu/Lark (飞书) channel plugin for [Clawdbot](https://github.com/clawdbot/clawdbot).

## Installation

```bash
clawdbot plugins install @m1heng-clawd/feishu
```

Or install via npm:

```bash
npm install @m1heng-clawd/feishu
```

## Configuration

1. Create a self-built app on [Feishu Open Platform](https://open.feishu.cn)
2. Get your App ID and App Secret from the Credentials page
3. Enable required permissions (see below)
4. Configure the plugin:

### Required Permissions

| Permission | Scope | Description |
|------------|-------|-------------|
| `contact:user.base:readonly` | User info | Get basic user information |
| `im:message` | Messaging | Send and receive messages |
| `im:message.p2p_msg:readonly` | DM | Read direct messages to bot |
| `im:message.group_at_msg:readonly` | Group | Receive @mention messages in groups |
| `im:message:send_as_bot` | Send | Send messages as the bot |
| `im:resource` | Media | Upload and download images/files |

### Optional Permissions (for full functionality)

| Permission | Scope | Description |
|------------|-------|-------------|
| `im:message.group_msg` | Group | Read all group messages (sensitive) |
| `im:message:readonly` | Read | Get message history |
| `im:message:update` | Edit | Update/edit sent messages |
| `im:message:recall` | Recall | Recall sent messages |
| `im:message.reactions:read` | Reactions | View message reactions |

```bash
clawdbot config set channels.feishu.appId "cli_xxxxx"
clawdbot config set channels.feishu.appSecret "your_app_secret"
clawdbot config set channels.feishu.enabled true
```

## Configuration Options

```yaml
channels:
  feishu:
    enabled: true
    appId: "cli_xxxxx"
    appSecret: "secret"
    # Domain: "feishu" (China) or "lark" (International)
    domain: "feishu"
    # Connection mode: "websocket" (recommended) or "webhook"
    connectionMode: "websocket"
    # DM policy: "pairing" | "open" | "allowlist"
    dmPolicy: "pairing"
    # Group policy: "open" | "allowlist" | "disabled"
    groupPolicy: "allowlist"
    # Require @mention in groups
    requireMention: true
    # Max media size in MB (default: 30)
    mediaMaxMb: 30
    # Render mode for bot replies: "auto" | "raw" | "card"
    renderMode: "auto"
```

### Render Mode

| Mode | Description |
|------|-------------|
| `auto` | (Default) Automatically detect: use card for messages with code blocks or tables, plain text otherwise. |
| `raw` | Always send replies as plain text. Markdown tables are converted to ASCII. |
| `card` | Always send replies as interactive cards with full markdown rendering (syntax highlighting, tables, clickable links). |

## Features

- WebSocket and Webhook connection modes
- Direct messages and group chats
- Message replies and quoted message context
- **Inbound media support**: AI can see images, read files (PDF, Excel, etc.), and process rich text with embedded images
- Image and file uploads (outbound)
- Typing indicator (via emoji reactions)
- Pairing flow for DM approval
- User and group directory lookup
- **Card render mode**: Optional markdown rendering with syntax highlighting

## Services

The Feishu plugin exposes several HTTP APIs on localhost for the AI Agent to perform advanced actions.

| Service | Port | Description |
|---------|------|-------------|
| **Docs API** | `18798` | **Unified document reader** - read any Feishu doc with one endpoint. |
| **Sheets API** | `18796` | Read/write Feishu Spreadsheets. |
| **Bitable API**| `18795` | Read/write Feishu Bitables (multi-dimensional tables). |
| **Project API**| `18793` | Manage Feishu Projects (work items, issues). |
| **Task API**   | `18794` | Manage Feishu Tasks. |
| **Cron API** | `18797` | Schedule tasks (delayed, absolute time, periodic). |
| **RAG API** | `18800` | Vector search over indexed Feishu documents. |

### Docs API - Unified Document Reader

The Docs API provides a single endpoint to read any type of Feishu document.

```bash
# Read any Feishu document URL
curl "http://127.0.0.1:18798/read?url=<feishu_document_url>"
```

**Supported URL formats:**
- Wiki: `https://xxx.feishu.cn/wiki/xxxtoken`
- Docx: `https://xxx.feishu.cn/docx/xxxtoken`
- Sheet: `https://xxx.feishu.cn/sheets/xxxtoken`
- Bitable: `https://xxx.feishu.cn/base/xxxtoken?table=tblxxx`

**How it works:**
1. Parses the URL to detect document type
2. For Wiki URLs, resolves the actual content type (docx/sheet/bitable)
3. Automatically calls the appropriate API (Sheets API or Bitable API)
4. Returns unified response with content

**Response examples:**
- Docx: `{ type: "docx", content: "..." }`
- Sheet: `{ type: "sheet", sheets: [...], data: [...] }`
- Bitable: `{ type: "bitable", tables: [...], data: [...] }`

### Cron API Usage

Claude can use the Cron API to set reminders or schedule tasks.

- **Add Task**: `POST /add` with body `{ "job": { ... } }`
  - Supports `schedule: { kind: "at", at: "2026-02-10 15:00:00" }` for absolute time.
  - Supports `schedule: { kind: "every", everyMs: 60000 }` for periodic tasks.
- **List Tasks**: `GET /list`
- **Remove Task**: `POST /remove` with body `{ "id": "job_id" }`
- **Run Immediately**: `POST /run` with body `{ "id": "job_id" }`

## License

MIT
