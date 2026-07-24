---
name: ima-to-share-together
description: Sync IMA knowledge base docs (links tagged "share-together") to share-together room. Uses idempotency tracking — each run syncs only new links. Use when user wants to sync IMA docs to share-together, or mentions "sync ima", "ima to share-together", "push ima links".
---

# IMA → Share Together Sync

## How to run

All commands use `npx -p github:s7v7nislands/share-together` — no repo clone or npm
install needed. `npx` pulls the package from GitHub and runs the specified binary.
First run caches the package locally; subsequent runs are instant.

> **Windows**: Use **Git Bash** (bundled with Git for Windows) or **WSL** — the commands
> below are bash.

## Quick start

```bash
npx -p github:s7v7nislands/share-together sync-ima \
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
# 1. share-together config (validates JSON is readable)
node -e "const c=require('fs').readFileSync(require('os').homedir()+'/.share-together.json','utf8');console.log(JSON.stringify(JSON.parse(c),null,2))"

# 2. Logged in
npx -p github:s7v7nislands/share-together share-together whoami

# 3. IMA credentials
node -e "
const {homedir}=require('os'),{join}=require('path'),{readFileSync}=require('fs');
const d=join(homedir(),'.config','ima');
for(const f of['client_id','api_key']){
  try{const v=readFileSync(join(d,f),'utf8').trim();console.log(f+': '+(v?'SET':'EMPTY'))}
  catch(e){console.log(f+': MISSING')}
}
"
```

Set share-together base URL if needed:

```bash
npx -p github:s7v7nislands/share-together share-together config --url https://share-together.s7v7nislands.workers.dev/
```

## Workflow

### 1. Determine KB ID

Ask the user if not provided. List available KBs:

```bash
npx -p github:s7v7nislands/share-together ima-api list-kb
```

### 2. Dry-run

```bash
npx -p github:s7v7nislands/share-together sync-ima \
  --kb-id <KB_ID> \
  --room room-85197e90533d05d0 \
  --dry-run --verbose
```

### 3. Sync

```bash
npx -p github:s7v7nislands/share-together sync-ima \
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

## Commands

| Binary | Package | Purpose |
|--------|---------|---------|
| `sync-ima` | `github:s7v7nislands/share-together` | Main sync: IMA → share-together |
| `ima-api` | `github:s7v7nislands/share-together` | IMA OpenAPI helper (list KBs, export links) |
| `share-together` | `github:s7v7nislands/share-together` | share-together CLI (login, list rooms, add links) |

All invoked as: `npx -p github:s7v7nislands/share-together <binary> [args...]`

## Troubleshooting

- **"Authentication required"**: `npx -p github:s7v7nislands/share-together share-together login`
- **"缺少 ima 凭证"**: Set env vars or files in `~/.config/ima/`
- **"Room not found"**: `npx -p github:s7v7nislands/share-together share-together rooms`
- **Nothing to sync**: All links already tracked. Use `--force` for full re-sync.
