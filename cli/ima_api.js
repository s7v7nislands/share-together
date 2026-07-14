#!/usr/bin/env node
/**
 * ima OpenAPI helper CLI (zero external dependencies).
 *
 * Calls Tencent ima (https://ima.qq.com) OpenAPI.
 *
 * Auth: two custom headers (NOT standard Authorization):
 *     ima-openapi-clientid: <ClientID>
 *     ima-openapi-apikey:   <APIKey>
 * All requests are HTTP POST + JSON body.
 *
 * Credentials are read from env vars (IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY)
 * or from files ~/.config/ima/client_id and ~/.config/ima/api_key.
 *
 * Usage:
 *     node ima_api.js list-kb
 *     node ima_api.js search --query "关键词" --kb-id "KB_ID"
 *     node ima_api.js get-media-info --media-id "MEDIA_ID"
 *     node ima_api.js import-url --kb-id "KB_ID" --urls https://a.com https://b.com
 *     node ima_api.js list-notes
 *     node ima_api.js list-note-by-folder --folder-id "FOLDER_ID"
 *     node ima_api.js get-note --doc-id "DOC_ID" --fmt 0
 *     node ima_api.js import-note --content "正文" --folder-id "FOLDER_ID"
 *     node ima_api.js list-kb-items --kb-id "KB_ID" [--type WEB] [--tag share-together]
 *     node ima_api.js export-links --kb-id "KB_ID" [--tag share-together] [--json] [--out 导出.md]
 *     node ima_api.js export-share-together --kb-id "KB_ID" [--json] [--out 导出.md]
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://ima.qq.com";

// ── Credential loading ──────────────────────────────────────────────────────

async function readFileSafe(path) {
  try {
    return (await readFile(path, "utf-8")).trim();
  } catch {
    return null;
  }
}

async function loadCredentials() {
  const cid =
    process.env.IMA_OPENAPI_CLIENTID ||
    (await readFileSafe(join(homedir(), ".config", "ima", "client_id")));
  const key =
    process.env.IMA_OPENAPI_APIKEY ||
    (await readFileSafe(join(homedir(), ".config", "ima", "api_key")));
  return { clientId: cid, apiKey: key };
}

// ── API call ────────────────────────────────────────────────────────────────

async function call(path, payload) {
  const { clientId, apiKey } = await loadCredentials();
  if (!clientId || !apiKey) {
    console.error(
      "缺少 ima 凭证。请设置环境变量 IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY，\n" +
        "或在 ~/.config/ima/client_id 与 ~/.config/ima/api_key 中写入凭证。\n" +
        "凭证获取: https://ima.qq.com/agent-interface"
    );
    process.exit(1);
  }

  const url = BASE_URL + path;
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
    console.error("连接失败:", err.message);
    process.exit(1);
  }

  const text = await resp.text();
  if (!resp.ok) {
    console.error(`HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function ts(ms) {
  try {
    return new Date(Number(ms)).toISOString().slice(0, 10);
  } catch {
    return String(ms);
  }
}

// ── Command handlers ────────────────────────────────────────────────────────

async function cmdListKb(args) {
  return call("/openapi/wiki/v1/get_addable_knowledge_base_list", {
    cursor: args.cursor || "",
    limit: args.limit || 50,
  });
}

async function cmdSearch(args) {
  return call("/openapi/wiki/v1/search_knowledge", {
    query: args.query,
    knowledge_base_id: args["kb-id"] || "",
    cursor: args.cursor || "",
    limit: args.limit || 20,
  });
}

async function cmdGetContent(args) {
  return call("/openapi/wiki/v1/get_media_info", {
    media_id: args["media-id"],
  });
}

async function cmdImportUrl(args) {
  return call("/openapi/wiki/v1/import_urls", {
    knowledge_base_id: args["kb-id"],
    urls: args.urls, // array
  });
}

async function cmdListNotes(args) {
  return call("/openapi/note/v1/list_note_folder_by_cursor", {
    cursor: args.cursor || "",
    limit: args.limit || 50,
  });
}

async function cmdListNoteByFolder(args) {
  return call("/openapi/note/v1/list_note_by_folder_id", {
    folder_id: args["folder-id"] || "",
    cursor: args.cursor || "",
    limit: args.limit || 50,
  });
}

async function cmdGetNote(args) {
  return call("/openapi/note/v1/get_doc_content", {
    doc_id: args["doc-id"],
    target_content_format: args.fmt ?? 0,
  });
}

async function cmdImportNote(args) {
  return call("/openapi/note/v1/import_doc", {
    content: args.content,
    content_format: 1,
    folder_id: args["folder-id"] || "",
  });
}

async function cmdListKbItems(args) {
  const payload = {
    knowledge_base_id: args["kb-id"],
    limit: args.limit || 50,
    cursor: args.cursor || "",
  };
  if (args.type) {
    payload.filters = [
      {
        filter_type: "MEDIA_TYPE_FILTER_TYPE",
        media_type_filter: { media_type: [args.type] },
      },
    ];
  }

  const listed = await call("/openapi/wiki/v1/get_knowledge_list", payload);
  let items = extractItems(listed);

  // client-side tag filter
  if (args.tag) {
    items = items.filter((it) => (it.tags || []).includes(args.tag));
  }
  return items;
}

async function cmdExportLinks(args) {
  // 1) list items in the KB
  const listed = await call("/openapi/wiki/v1/get_knowledge_list", {
    knowledge_base_id: args["kb-id"],
    limit: args.limit || 50,
    cursor: "",
  });
  let items = extractItems(listed);

  // 2) optional tag filter (client-side)
  const tag = args.tag || "";
  if (tag) {
    items = items.filter((it) => (it.tags || []).includes(tag));
  }

  // 3) keep only WEB/link items (media_type == 2)
  const webItems = items.filter((it) => it.media_type === 2);

  const records = [];
  for (const it of webItems) {
    const mid = it.media_id || "";
    const title = it.title || mid;
    const info = await call("/openapi/wiki/v1/get_media_info", { media_id: mid });
    const data = (info && info.data) || {};
    // KEY: source URL lives in get_media_info (url_info.url)
    const url = ((data.url_info || {}).url || "");
    records.push({
      media_id: mid,
      title,
      url,
      tags: it.tags || [],
      create_time: it.create_time,
    });
  }

  if (args.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  // Markdown output
  const lines = [
    "# ima 链接类文档导出",
    "",
    "> 由 ima-openapi skill 自动生成。源 URL 通过 get_media_info 提取。",
    "",
  ];

  for (const r of records) {
    let line;
    if (r.url) {
      line = `- [${r.title}](${r.url})`;
    } else {
      line = `- ${r.title} (无 URL)`;
    }
    const meta = [];
    if (r.tags.length) {
      meta.push(`标签: ${r.tags.join(", ")}`);
    }
    if (r.create_time) {
      meta.push(`创建: ${ts(r.create_time)}`);
    }
    if (meta.length) {
      line += `  _(${meta.join("; ")})_`;
    }
    lines.push(line);
  }

  lines.push("");
  lines.push(`共 ${records.length} 条链接类文档（标签筛选: ${tag || "无"}）。`);
  lines.push("");

  const text = lines.join("\n");

  if (args.out) {
    const { writeFile } = await import("node:fs/promises");
    const outPath = args.out.startsWith("~")
      ? join(homedir(), args.out.slice(1))
      : args.out;
    await writeFile(outPath, text, "utf-8");
    console.log(`已写入 ${outPath} (${records.length} 条)`);
  } else {
    console.log(text);
  }
}

async function cmdExportShareTogether(args) {
  args.tag = "share-together";
  return cmdExportLinks(args);
}

// ── Argument parser (minimal, mimics the Python argparse style) ────────────

function parseArgs(argv) {
  const args = [];
  const opts = {};
  let i = 2;

  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--")) {
      // --key value  or  --key=value
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
      // Accumulate arrays for repeatable flags like --urls
      if (opts[key] !== undefined && Array.isArray(opts[key])) {
        opts[key].push(val);
      } else if (opts[key] !== undefined) {
        opts[key] = [opts[key], val];
      } else {
        opts[key] = val;
      }
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

  // Normalize shortcuts
  if (opts.q !== undefined && opts.query === undefined) opts.query = opts.q;
  if (opts.k !== undefined && opts["kb-id"] === undefined) opts["kb-id"] = opts.k;

  return { args, opts };
}

function showHelp() {
  console.log(`ima OpenAPI helper CLI

Usage:
  node ima_api.js <command> [options]

Commands:
  list-kb                               List knowledge bases
  search        --query <q> --kb-id <id> Search knowledge base
  get-media-info --media-id <id>        Get media detail incl. source URL
  import-url    --kb-id <id> --urls ...  Import URLs into KB
  list-notes                             List notebooks
  list-note-by-folder --folder-id <id>   List notes in a notebook
  get-note      --doc-id <id>            Read a note body
  import-note   --content <c> --folder-id <id>  Create a note
  list-kb-items --kb-id <id> [--type WEB] [--tag share-together]
  export-links  --kb-id <id> [--tag share-together] [--json] [--out 导出.md]
  export-share-together --kb-id <id> [--json] [--out 导出.md]

Auth:
  Set env vars:  IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY
  Or files:      ~/.config/ima/client_id  and  ~/.config/ima/api_key

  Get credentials at: https://ima.qq.com/agent-interface
`);
}

// ── Main ────────────────────────────────────────────────────────────────────

const { args, opts } = parseArgs(process.argv);

if (opts.help || opts.h) {
  showHelp();
  process.exit(0);
}

const cmd = args[0];

// Map aliases
const aliases = {
  "get-content": "get-media-info",
  st: "export-share-together",
};

const resolved = aliases[cmd] || cmd;

const commands = {
  "list-kb": cmdListKb,
  search: cmdSearch,
  "get-media-info": cmdGetContent,
  "import-url": cmdImportUrl,
  "list-notes": cmdListNotes,
  "list-note-by-folder": cmdListNoteByFolder,
  "get-note": cmdGetNote,
  "import-note": cmdImportNote,
  "list-kb-items": cmdListKbItems,
  "export-links": cmdExportLinks,
  "export-share-together": cmdExportShareTogether,
};

const handler = commands[resolved];
if (!handler) {
  if (resolved && resolved !== "help") {
    console.error(`Unknown command: ${resolved}`);
  }
  showHelp();
  process.exit(resolved ? 1 : 0);
}

// Parse numeric values
if (opts.limit) opts.limit = Number(opts.limit);
if (opts.fmt !== undefined) opts.fmt = Number(opts.fmt);

const result = await handler(opts);
if (result !== undefined && result !== null) {
  console.log(JSON.stringify(result, null, 2));
}
