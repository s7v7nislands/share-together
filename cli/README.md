# share-together CLI

Command-line client for [share-together](https://github.com/s7v7nislands/share_together) — add and list shared links in your rooms.

## Setup

```bash
cd cli
npm install
npm link   # makes `share-together` available globally
```

Or run directly:

```bash
node cli/cli.js
```

## Quick start

```bash
# 1. Point to your share-together instance
share-together config --url https://your-app.example.com

# 2. Login
share-together login your-username

# 3. Create a room
share-together room create "Book Club"

# 4. Add a share URL
share-together add --room room-abc123 https://example.com/article -t tech,blog -n "Great read"

# 5. List links
share-together links -r room-abc123 --sort hot
```

## Commands

| Command | Description |
|---------|-------------|
| `config [--url <url>]` | Show or set the base URL |
| `login [username] [password]` | Log in (prompts interactively if omitted) |
| `register [username] [password]` | Register a new account |
| `logout` | Log out and clear session |
| `whoami` | Show current user |
| `rooms` | List your rooms |
| `room create [name]` | Create a new room |
| `links --room <slug>` | List links in a room |
| `add --room <slug> <url>` | Add a share URL with optional `--tag` and `--note` |

## Configuration

Settings are stored in `~/.share-together.json`:

```json
{
  "base_url": "https://your-app.example.com",
  "session": {
    "token": "...",
    "expires_at": "2026-07-21T..."
  }
}
```

## ima OpenAPI — export share-together links

`ima_api.js` calls the [Tencent ima OpenAPI](https://ima.qq.com/agent-interface) to
export link-type knowledge-base items tagged `share-together`, resolving each one
to its real source URL via `get_media_info`.

### Setup (credentials)

Get your ClientID and APIKey at <https://ima.qq.com/agent-interface>, then:

```bash
# Option A – environment variables
export IMA_OPENAPI_CLIENTID="your-client-id"
export IMA_OPENAPI_APIKEY="your-api-key"

# Option B – files
mkdir -p ~/.config/ima
echo "your-client-id" > ~/.config/ima/client_id
echo "your-api-key"  > ~/.config/ima/api_key
```

### Run

```bash
# List knowledge bases (get the KB_ID)
node cli/ima_api.js list-kb

# Export share-together tagged links as JSON
node cli/ima_api.js export-share-together --kb-id "YOUR_KB_ID" --json

# Save as Markdown file
node cli/ima_api.js export-share-together --kb-id "YOUR_KB_ID" --out ./links.md

# Export with a different tag
node cli/ima_api.js export-links --kb-id "YOUR_KB_ID" --tag my-tag --json
```

### All commands

| Command | Description |
|---------|-------------|
| `list-kb` | List knowledge bases |
| `search --query <q> --kb-id <id>` | Search a knowledge base |
| `get-media-info --media-id <id>` | Get media detail incl. source URL |
| `import-url --kb-id <id> --urls …` | Import web pages into a KB |
| `list-notes` | List notebooks |
| `list-note-by-folder --folder-id <id>` | List notes in a notebook |
| `get-note --doc-id <id>` | Read a note body |
| `import-note --content <c> --folder-id <id>` | Create a note |
| `list-kb-items --kb-id <id> [--type WEB] [--tag …]` | List items in a KB |
| `export-links --kb-id <id> [--tag …] [--json] [--out …]`| Export link items as Markdown |
| `export-share-together --kb-id <id> [--json] [--out …]` | Shortcut for `export-links --tag share-together` |

**Zero external dependencies** — uses only Node.js built-in `fetch`, `fs`, `os`, `path`.

## sync_ima — 从 ima 同步链接到 share-together

`sync_ima.js` 组合了 `ima_api.js` 的链接获取能力和 `cli.js` 的提交能力，
通过本地追踪文件实现幂等同步——每次运行只同步新增的链接。

> **注意：** ima OpenAPI 的 `get_knowledge_list` 不返回 `create_time`，
> 因此不支持按创建日期筛选。通过幂等追踪，每日运行自然只同步当天新增的链接。

### 用法

```bash
# 同步新增的 share-together 链接（默认行为）
node cli/sync_ima.js -k <KB_ID> -r <room-slug>

# 全量同步（忽略已同步记录）
node cli/sync_ima.js -k <KB_ID> -r <room-slug> --force

# 预览模式（不实际提交）
node cli/sync_ima.js -k <KB_ID> -r <room-slug> --dry-run

# 使用自定义标签
node cli/sync_ima.js -k <KB_ID> -r <room-slug> --tag my-links

# 详细日志
node cli/sync_ima.js -k <KB_ID> -r <room-slug> -v
```

### 参数说明

| 参数 | 简写 | 必选 | 说明 |
|------|------|------|------|
| `--kb-id` | `-k` | ✓ | ima 知识库 ID |
| `--room` | `-r` | ✓ | share-together 房间 slug |
| `--tag` | | | 标签筛选 [默认: share-together] |
| `--force` | `-f` | | 全量同步，忽略已同步记录 |
| `--dry-run` | `-n` | | 预览模式，不实际提交 |
| `--verbose` | `-v` | | 显示详细日志 |

### 幂等追踪

通过本地文件 `~/.config/ima/synced.json` 记录每个房间已同步的 `media_id`。
每次运行只处理新增的链接，已同步的自动跳过。适合 cron / 定时任务每日执行。

### 工作流程

1. 从 ima 知识库获取带指定标签的链接（自动分页）
2. 幂等过滤——排除已同步的 `media_id`
3. 通过 `get_media_info` 解析每条链接的源 URL
4. 调用 share-together API 逐条提交到房间
5. 更新追踪文件

### 前置条件

- ima 凭证已配置（同 `ima_api.js`）
- share-together 已登录（`share-together login`）

## Environment

- **Node.js >= 18** (uses built-in `fetch`, ESM)
- Zero external dependencies
