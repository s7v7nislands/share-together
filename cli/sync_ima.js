#!/usr/bin/env node
/**
 * sync_ima.js — 从 ima 知识库同步链接到 share-together
 *
 * 组合 ima_api.js（获取/筛选链接）和 cli.js（提交到 share-together）的功能，
 * 支持按日期或日期范围筛选。
 *
 * 用法:
 *   node sync_ima.js --kb-id <KB_ID> --room <slug>            # 同步所有 share-together 链接
 *   node sync_ima.js --kb-id <KB_ID> --room <slug> --date 2025-07-01
 *   node sync_ima.js --kb-id <KB_ID> --room <slug> --from 2025-07-01 --to 2025-07-14
 *   node sync_ima.js --kb-id <KB_ID> --room <slug> --dry-run # 预览模式，不实际提交
 *   node sync_ima.js --kb-id <KB_ID> --room <slug> --tag my-tag  # 自定义标签筛选
 *
 * 凭据:
 *   ima:        环境变量 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY
 *               或文件 ~/.config/ima/client_id 和 ~/.config/ima/api_key
 *   share-together: ~/.share-together.json (由 share-together cli 管理)
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "./lib/api.js";

// ═══════════════════════════════════════════════════════════════════════════════
// ima OpenAPI 层 (从 ima_api.js 提取)
// ═══════════════════════════════════════════════════════════════════════════════

const IMA_BASE_URL = "https://ima.qq.com";

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

    // 客户端标签筛选 + 仅保留链接类型 (media_type === 2)
    for (const it of items) {
      if (it.media_type === 2 && (it.tags || []).includes(tag)) {
        allItems.push(it);
      }
    }

    // 检查是否还有更多页
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
// 日期工具
// ═══════════════════════════════════════════════════════════════════════════════

/** 将 YYYY-MM-DD 转为当天 00:00:00 的毫秒时间戳 */
function dateToMs(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) {
    console.error(`无效日期: ${dateStr}，请使用 YYYY-MM-DD 格式`);
    process.exit(1);
  }
  return d.getTime();
}

/** 将毫秒时间戳转为 YYYY-MM-DD */
function msToDate(ms) {
  return new Date(Number(ms)).toISOString().slice(0, 10);
}

/** 根据日期范围过滤链接 */
function filterByDateRange(items, fromMs, toMs) {
  if (fromMs === null && toMs === null) return items;

  return items.filter((it) => {
    const created = Number(it.create_time);
    if (isNaN(created)) return false;
    if (fromMs !== null && created < fromMs) return false;
    if (toMs !== null && created >= toMs + 86400000) return false; // toMs 当天结束
    return true;
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

日期筛选 (可选):
  --date   <YYYY-MM-DD>  仅同步指定日期的链接
  --from   <YYYY-MM-DD>  起始日期（含）
  --to     <YYYY-MM-DD>  结束日期（含）

其他选项:
  --tag    <tag>         ima 标签筛选 [默认: share-together]
  --dry-run, -n          预览模式，只显示将要同步的链接，不实际提交
  --verbose, -v          显示详细日志
  --help,  -h            显示帮助

示例:
  # 同步所有 share-together 标签的链接
  node sync_ima.js -k kb_abc123 -r room-xyz

  # 仅同步指定日期的链接
  node sync_ima.js -k kb_abc123 -r room-xyz --date 2025-07-01

  # 同步日期范围内的链接
  node sync_ima.js -k kb_abc123 -r room-xyz --from 2025-07-01 --to 2025-07-14

  # 预览模式
  node sync_ima.js -k kb_abc123 -r room-xyz --from 2025-07-01 --to 2025-07-14 --dry-run

  # 使用自定义标签
  node sync_ima.js -k kb_abc123 -r room-xyz --tag my-links --date 2025-07-01
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

// ── 日期参数处理 ──

let fromMs = null;
let toMs = null;

if (opts.date) {
  // 仅指定日期
  fromMs = dateToMs(opts.date);
  toMs = fromMs;
}

if (opts.from) {
  fromMs = dateToMs(opts.from);
}

if (opts.to) {
  toMs = dateToMs(opts.to);
}

// ── 日期范围显示 ──

function dateRangeDesc() {
  if (opts.date) return opts.date;
  const parts = [];
  if (fromMs !== null) parts.push(`从 ${msToDate(fromMs)}`);
  if (toMs !== null) parts.push(`到 ${msToDate(toMs)}`);
  return parts.length > 0 ? parts.join(" ") : "全部日期";
}

// ── 主逻辑 ──

async function main() {
  console.log(`╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  sync_ima — ima → share-together 链接同步              ║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║  ima KB:   ${kbId}`);
  console.log(`║  房间:     ${room}`);
  console.log(`║  标签:     ${tag}`);
  console.log(`║  日期范围: ${dateRangeDesc()}`);
  if (dryRun) console.log(`║  模式:     🔍 预览 (dry-run)`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log();

  // 1) 获取 ima 中的链接
  console.log("📥 正在从 ima 获取链接列表...");
  const allItems = await fetchImaLinks(kbId, tag);
  console.log(`   找到 ${allItems.length} 条带「${tag}」标签的链接`);

  // 2) 按日期过滤
  const filtered = filterByDateRange(allItems, fromMs, toMs);
  if (allItems.length !== filtered.length) {
    console.log(
      `   日期过滤后剩余 ${filtered.length} 条（筛选条件: ${dateRangeDesc()}）`
    );
  }

  if (filtered.length === 0) {
    console.log("\n✅ 没有需要同步的链接");
    process.exit(0);
  }

  // 3) 解析每条链接的源 URL
  console.log("\n🔗 正在解析链接源 URL...");
  const linkRecords = [];
  for (const it of filtered) {
    const url = await resolveLinkUrl(it);
    const title = it.title || it.media_id || "";
    const created = msToDate(it.create_time);
    if (verbose) {
      console.log(`   [${created}] ${title} → ${url || "(无 URL)"}`);
    }
    if (url) {
      linkRecords.push({ title, url, created, tags: it.tags || [] });
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
      console.log(`   [${r.created}] ${r.title}`);
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

  for (const r of linkRecords) {
    try {
      const data = await api.addLink(room, r.url, r.tags, null);
      if (data.duplicate) {
        duplicateCount++;
        console.log(`   ⚠ 重复: ${r.title}`);
      } else {
        successCount++;
        console.log(`   ✓ ${r.title}`);
      }
    } catch (err) {
      failCount++;
      console.log(`   ✖ 失败: ${r.title} — ${err.message}`);
    }
  }

  // 6) 汇总
  console.log("\n══════════════════════════════════════════");
  console.log(` 同步完成: ✓ ${successCount}  重复 ${duplicateCount}  失败 ${failCount}`);
  console.log("══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\n❌ 执行失败:", err.message);
  process.exit(1);
});
