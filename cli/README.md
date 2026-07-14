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

## Environment

- **Node.js >= 18** (uses built-in `fetch`, ESM)
- Zero external dependencies
