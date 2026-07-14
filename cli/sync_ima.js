#!/usr/bin/env node
/**
 * sync_ima.js — 从 ima 知识库同步链接到 share-together
 *
 * 从 ima 知识库获取带指定标签的链接，解析源 URL 后提交到 share-together 房间。
 * 使用本地追踪文件记录已同步的 media_id，每次运行只同步新增的链接（幂等）。
 *
 * 用法:
 *   node sync_ima.js --kb-id <KB_ID> --room <slug>            # 同步新增的 share-together 链接
 *   node sync_ima.js --kb-id <KB_ID> --room <slug> --force    # 全量同步（忽略追踪记录）
 *   node sync_ima.js --kb-id <KB_ID> --room <slug> --tag tag  # 自定义标签筛选
 *   node sync_ima.js --kb-id <KB_ID> --room <slug> --dry-run  # 预览模式
 *
 * 凭据:
 *   ima:        环境变量 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY
 *               或文件 ~/.config/ima/client_id 和 ~/.config/ima/api_key
 *   share-together: ~/.share-together.json (由 share-together cli 管理)
 *
 * 追踪文件: ~/.config/ima/synced.json — 记录每个房间已同步的 media_id
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { ApiClient } from "./lib/api.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════════════

const IMA_BASE_URL = "https://ima.qq.com";
const SYNCED_FILE = join(homedir(), ".config", "ima", "synced.json");

// ═══════════════════════════════════════════════════════════════════════════════
// ima OpenAPI 层
// ═══════════════════════════════════════════════════════════════════════════════

async function readFileSafe(path) {
  try {
    return (await readFile(path, "utf-8")).trim();
  } catch {
    return null;
  }
}

async function loadImaCredentials() {
  const cid =
    process.env.IMA_OPENAPI_CLIENTID ||
    (await readFileSafe(join(homedir(), ".config", "ima", "client_id")));
  const key =
    process.env.IMA_OPENAPI_APIKEY ||
    (await readFileSafe(join(homedir(), ".config", "ima", "api_key")));
  return { clientId: cid, apiKey: key };
}

async function imaCall(path, payload) {
  const { clientId, apiKey } = await loadImaCredentials();
  if (!clientId || !apiKey) {
    console.error(
      "缺少 ima 凭证。请设置环境变量 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY，\n" +
        "或在 ~/.config/ima/client_id 与 ~/.config/ima/api_key 中写入凭证。\n" +
        "凭证获取: https://ima.qq.com/agent-interface"
    );
    process.exit(1);
  }

  const url = IMA_BASE_URL + path;
  const body = JSON.stringify(payload);

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ima-openapi-clientid": clientId,
        "ima-openapi-apikey": apiKey,
      },
      body,
    });
  } catch (err) {
    console.error("ima 连接失败:", err.message);
    process.exit(1);
  }

  const text = await resp.text();
  if (!resp.ok) {
    console.error(`ima HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractItems(listed) {
  if (listed && typeof listed === "object") {
    for (const key of ["knowledge_list", "list", "items"]) {
      if (Array.isArray(listed[key])) return listed[key];
    }
    const d = listed.data;
    if (d && typeof d === "object") {
      for (const key of ["knowledge_list", "list", "items"]) {
        if (Array.isArray(d[key])) return d[key];
      }
    }
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 从 ima 获取带 tag 的链接列表（支持分页）
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchImaLinks(kbId, tag) {
  const allItems = [];
  let cursor = "";

  while (true) {
    const payload = {
      knowledge_base_id: kbId,
      limit: 50,
      cursor,
    };

    const listed = await imaCall("/openapi/wiki/v1/get_knowledge_list", payload);
    const items = extractItems(listed);

    if (items.length === 0) break;

    for (const it of items) {
      if (it.media_type === 2 && (it.tags || []).includes(tag)) {
        allItems.push(it);
      }
    }

    const nextCursor =
      listed.next_cursor ||
      listed.nextCursor ||
      (listed.data && (listed.data.next_cursor || listed.data.nextCursor)) ||
      "";
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return allItems;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 获取每个链接的源 URL
// ═══════════════════════════════════════════════════════════════════════════════

async function resolveLinkUrl(item) {
  const mid = item.media_id || "";
  try {
    const info = await imaCall("/openapi/wiki/v1/get_media_info", { media_id: mid });
    const data = (info && info.data) || {};
    return ((data.url_info || {}).url || "");
  } catch {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 幂等追踪 — 记录已同步的 media_id
// ═══════════════════════════════════════════════════════════════════════════════

async function loadSynced() {
  try {
    const raw = await readFile(SYNCED_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSynced(data) {
  await mkdir(dirname(SYNCED_FILE), { recursive: true }).catch(() => {});
  await writeFile(SYNCED_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/** 返回尚未同步的 media_id 集合 */
function filterNew(items, syncedIds) {
  return items.filter((it) => {
    const mid = it.media_id || "";
    return mid && !syncedIds[mid];
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 命令行解析
// ═══════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = [];
  const opts = {};

  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      let key, val;
      if (eqIdx >= 0) {
        key = a.slice(2, eqIdx);
        val = a.slice(eqIdx + 1);
      } else {
        key = a.slice(2);
        const nxt = argv[i + 1];
        if (nxt !== undefined && !nxt.startsWith("-")) {
          val = nxt;
          i++;
        } else {
          val = true;
        }
      }
      opts[key] = val;
    } else if (a.startsWith("-") && a.length === 2) {
      const flag = a[1];
      const nxt = argv[i + 1];
      if (nxt !== undefined && !nxt.startsWith("-")) {
        opts[flag] = nxt;
        i++;
      } else {
        opts[flag] = true;
      }
    } else {
      args.push(a);
    }
    i++;
  }

  return { args, opts };
}

function showHelp() {
  console.log(`sync_ima — 从 ima 知识库同步链接到 share-together

用法:
  node sync_ima.js --kb-id <KB_ID> --room <slug> [选项]

必选参数:
  --kb-id, -k <id>      ima 知识库 ID
  --room,  -r <slug>    share-together 房间 slug

其他选项:
  --tag     <tag>        ima 标签筛选 [默认: share-together]
  --force,  -f           全量同步，忽略已同步记录
  --dry-run, -n          预览模式，只显示将要同步的链接，不实际提交
  --verbose, -v          显示详细日志
  --help,   -h           显示帮助

工作原理:
  通过本地追踪文件 (~/.config/ima/synced.json) 记录每个房间已同步的 media_id。
  每次运行只同步新增的链接，已同步的自动跳过。适合 cron / 定时任务每日执行。

  注意: ima OpenAPI 的 get_knowledge_list 不返回 create_time，
  因此不支持按创建日期筛选。通过幂等追踪，每日运行自然只同步当天新增的链接。

示例:
  # 同步新增的 share-together 链接（默认行为）
  node sync_ima.js -k <KB_ID> -r room-xyz

  # 全量同步（跳过幂等检查）
  node sync_ima.js -k <KB_ID> -r room-xyz --force

  # 预览模式
  node sync_ima.js -k <KB_ID> -r room-xyz --dry-run

  # 使用自定义标签
  node sync_ima.js -k <KB_ID> -r room-xyz --tag my-links
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════════

const { opts } = parseArgs(process.argv);

if (opts.help || opts.h) {
  showHelp();
  process.exit(0);
}

// ── 参数校验 ──

const kbId = opts["kb-id"] || opts.k;
const room = opts.room || opts.r;
const tag = opts.tag || "share-together";
const dryRun = opts["dry-run"] || opts.n || false;
const force = opts.force || opts.f || false;
const verbose = opts.verbose || opts.v || false;

if (!kbId) {
  console.error("缺少 --kb-id / -k 参数");
  showHelp();
  process.exit(1);
}

if (!room) {
  console.error("缺少 --room / -r 参数");
  showHelp();
  process.exit(1);
}

// ── 主逻辑 ──

async function main() {
  // 0) 加载已同步记录
  const synced = await loadSynced();
  const syncedIds = synced[room] || {};
  const syncedCount = Object.keys(syncedIds).length;

  console.log(`╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  sync_ima — ima → share-together 链接同步              ║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║  ima KB:     ${kbId}`);
  console.log(`║  房间:       ${room}`);
  console.log(`║  标签:       ${tag}`);
  console.log(`║  已同步记录: ${syncedCount} 条`);
  if (force) console.log(`║  模式:       🔄 全量同步（忽略已同步记录）`);
  if (dryRun) console.log(`║  模式:       🔍 预览 (dry-run)`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log();

  // 1) 获取 ima 中的链接
  console.log("📥 正在从 ima 获取链接列表...");
  const allItems = await fetchImaLinks(kbId, tag);
  console.log(`   找到 ${allItems.length} 条带「${tag}」标签的链接`);

  // 2) 幂等过滤 — 排除已同步的
  let filtered;
  if (force) {
    filtered = allItems;
    if (allItems.length > 0) {
      console.log(`   🔄 全量模式: 跳过幂等检查，处理全部 ${allItems.length} 条`);
    }
  } else {
    filtered = filterNew(allItems, syncedIds);
    const skipped = allItems.length - filtered.length;
    if (skipped > 0) {
      console.log(`   跳过已同步 ${skipped} 条，剩余 ${filtered.length} 条待处理`);
    }
  }

  if (filtered.length === 0) {
    console.log("\n✅ 没有新增的链接需要同步");
    process.exit(0);
  }

  // 3) 解析每条链接的源 URL
  console.log("\n🔗 正在解析链接源 URL...");
  const linkRecords = [];
  for (const it of filtered) {
    const url = await resolveLinkUrl(it);
    const title = it.title || it.media_id || "";
    if (verbose) {
      console.log(`   ${title} → ${url || "(无 URL)"}`);
    }
    if (url) {
      linkRecords.push({ media_id: it.media_id, title, url, tags: it.tags || [] });
    } else if (verbose) {
      console.log(`   ⚠ 跳过 (无 URL): ${title}`);
    }
  }
  console.log(`   解析完成，有效链接 ${linkRecords.length} 条`);

  if (linkRecords.length === 0) {
    console.log("\n✅ 没有有效的链接需要同步");
    process.exit(0);
  }

  // 4) 预览模式：仅展示
  if (dryRun) {
    console.log("\n📋 预览 — 以下链接将被同步到 share-together:\n");
    for (const r of linkRecords) {
      console.log(`   ${r.title}`);
      console.log(`   ↳ ${r.url}`);
      console.log();
    }
    console.log(
      `共 ${linkRecords.length} 条链接。去掉 --dry-run 参数即可实际提交。`
    );
    process.exit(0);
  }

  // 5) 提交到 share-together
  console.log("\n📤 正在提交到 share-together...");
  const api = await ApiClient.fromConfig();

  let successCount = 0;
  let duplicateCount = 0;
  let failCount = 0;

  const newlySynced = [];

  for (const r of linkRecords) {
    try {
      const data = await api.addLink(room, r.url, r.tags, null);
      if (data.duplicate) {
        duplicateCount++;
        console.log(`   ⚠ 重复: ${r.title}`);
        newlySynced.push(r.media_id);
      } else {
        successCount++;
        console.log(`   ✓ ${r.title}`);
        newlySynced.push(r.media_id);
      }
    } catch (err) {
      // D1 UNIQUE constraint = duplicate on worker side (race condition)
      if (err.message && err.message.includes("UNIQUE constraint")) {
        duplicateCount++;
        console.log(`   ⚠ 重复 (服务端): ${r.title}`);
        newlySynced.push(r.media_id);
      } else {
        failCount++;
        console.log(`   ✖ 失败: ${r.title} — ${err.message}`);
      }
    }
  }

  // 6) 更新追踪文件
  if (newlySynced.length > 0) {
    const roomSynced = synced[room] || {};
    for (const mid of newlySynced) {
      roomSynced[mid] = true;
    }
    synced[room] = roomSynced;
    await saveSynced(synced);
    console.log(`   💾 已更新追踪记录 (+${newlySynced.length} 条)`);
  }

  // 7) 汇总
  console.log("\n══════════════════════════════════════════");
  console.log(` 同步完成: ✓ ${successCount}  重复 ${duplicateCount}  失败 ${failCount}`);
  console.log("══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\n❌ 执行失败:", err.message);
  process.exit(1);
});
