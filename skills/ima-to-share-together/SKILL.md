---
name: ima-to-share-together
description: Sync IMA knowledge base docs (links tagged "share-together") to share-together room. Uses idempotency tracking — each run syncs only new links. Use when user wants to sync IMA docs to share-together, or mentions "sync ima", "ima to share-together", "push ima links".
---

# IMA → Share Together Sync

## Resolve repo root

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
```

All scripts: `$REPO_ROOT/cli/sync_ima.js`, `$REPO_ROOT/cli/cli.js`, etc.

## Quick start

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
node "$REPO_ROOT/cli/sync_ima.js" \
  --kb-id <KB_ID> \
  --room room-85197e90533d05d0
```

**Defaults** (when not specified by user):
- **host**: `https://share-together.s7v7nislands.workers.dev/` (must be in `~/.share-together.json`)
- **room**: `room-85197e90533d05d0`
- **tag**: `share-together`

## How it works

Uses a local tracking file (`~/.config/ima/synced.json`) to remember which media_ids have been synced to each room. Each run:
1. Fetches all links tagged `share-together` from the IMA KB
2. Skips links already in the tracking file (idempotent)
3. Resolves each link's source URL via `get_media_info`
4. Submits to share-together
5. Updates the tracking file

Run daily (e.g. via cron) — each run naturally syncs only new links.

> **Note**: IMA's `get_knowledge_list` API does not return `create_time`, so date-based filtering is not supported. The idempotency approach is the correct pattern.

## Prerequisites

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)

# 1. share-together config
cat ~/.share-together.json | python3 -m json.tool

# 2. Logged in
node "$REPO_ROOT/cli/cli.js" whoami

# 3. IMA credentials
cat ~/.config/ima/client_id 2>/dev/null || echo "MISSING"
cat ~/.config/ima/api_key 2>/dev/null || echo "MISSING"
```

Set share-together base URL if needed:

```bash
node "$REPO_ROOT/cli/cli.js" config --url https://share-together.s7v7nislands.workers.dev/
```

## Workflow

### 1. Determine KB ID

Ask the user if not provided. List available KBs:

```bash
node "$REPO_ROOT/cli/ima_api.js" list-kb
```

### 2. Dry-run

```bash
node "$REPO_ROOT/cli/sync_ima.js" \
  --kb-id <KB_ID> \
  --room room-85197e90533d05d0 \
  --dry-run --verbose
```

### 3. Sync

```bash
node "$REPO_ROOT/cli/sync_ima.js" \
  --kb-id <KB_ID> \
  --room room-85197e90533d05d0 \
  --verbose
```

### 4. Report

Summarize: ✓ synced, ⚠ duplicates, ✖ failed.

## Parameters

| Parameter | Short | Required | Default | Description |
|-----------|-------|----------|---------|-------------|
| `--kb-id` | `-k` | Yes | — | IMA knowledge base ID |
| `--room` | `-r` | No | `room-85197e90533d05d0` | share-together room slug |
| `--tag` | | No | `share-together` | IMA tag filter |
| `--force` | `-f` | No | — | Full sync, ignore tracking |
| `--dry-run` | `-n` | No | — | Preview without submitting |
| `--verbose` | `-v` | No | — | Verbose output |

## Scripts

| Script | Purpose |
|--------|---------|
| `cli/sync_ima.js` | Main sync: IMA → share-together |
| `cli/ima_api.js` | IMA OpenAPI helper (list KBs, export links) |
| `cli/cli.js` | share-together CLI (login, list rooms, add links) |

## Troubleshooting

- **"Authentication required"**: `node "$REPO_ROOT/cli/cli.js" login`
- **"缺少 ima 凭证"**: Set env vars or files in `~/.config/ima/`
- **"Room not found"**: List rooms with `node "$REPO_ROOT/cli/cli.js" rooms`
- **Nothing to sync**: All links already tracked. Use `--force` for full re-sync.
