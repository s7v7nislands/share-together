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

## Environment

- **Node.js >= 18** (uses built-in `fetch`, ESM)
- Zero external dependencies
