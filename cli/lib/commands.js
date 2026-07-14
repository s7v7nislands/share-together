import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ApiClient, AuthError } from "./api.js";
import { clearSession, setBaseUrl, loadConfig } from "./config.js";

// ── helpers ──

function dim(s) {
  return `\x1b[2m${s}\x1b[0m`;
}

function bold(s) {
  return `\x1b[1m${s}\x1b[0m`;
}

function green(s) {
  return `\x1b[32m${s}\x1b[0m`;
}

function yellow(s) {
  return `\x1b[33m${s}\x1b[0m`;
}

function red(s) {
  return `\x1b[31m${s}\x1b[0m`;
}

function wrapError(err) {
  if (err instanceof AuthError) return red("✖ ") + err.message;
  return red("✖ ") + (err.message || "Unknown error");
}

function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function promptHidden(question) {
  const rl = readline.createInterface({ input, output });
  // Simple hidden input: write prompt, disable echo via raw mode
  // Fallback approach: just use a regular readline but show warning
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

// Simpler prompt that just reads a line
async function prompt(question) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

// ── commands ──

export async function cmdLogin(args, opts) {
  try {
    const api = await ApiClient.fromConfig();
    const username = args[0] || (await prompt("Username: "));
    const password = args[1] || (await prompt("Password: "));

    const user = await api.login(username, password);
    console.log(green("✓") + ` Logged in as ${bold(user.username)}`);
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdRegister(args, opts) {
  try {
    const api = await ApiClient.fromConfig();
    const username = args[0] || (await prompt("Username: "));
    const password = args[1] || (await prompt("Password: "));
    const confirm = args[2] || (await prompt("Confirm password: "));

    if (password !== confirm) {
      console.error(red("✖") + " Passwords do not match");
      process.exit(1);
    }

    const user = await api.register(username, password, confirm);
    console.log(green("✓") + ` Registered and logged in as ${bold(user.username)}`);
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdLogout(args, opts) {
  try {
    const api = await ApiClient.fromConfig();
    await api.logout();
    await clearSession();
    console.log(green("✓") + " Logged out");
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdWhoami(args, opts) {
  try {
    const api = await ApiClient.fromConfig();
    const data = await api.whoami();
    console.log(bold(data.user.username));
    console.log(dim(`  id: ${data.user.id}`));
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdRooms(args, opts) {
  try {
    const api = await ApiClient.fromConfig();
    const data = await api.listRooms();

    if (!data.rooms?.length) {
      console.log(dim("No rooms yet. Create one with: share-together room create"));
      return;
    }

    console.log(bold("Your rooms:"));
    for (const room of data.rooms) {
      const roleTag = room.role === "owner" ? green("[owner]") : dim("[member]");
      const name = room.name || room.slug;
      console.log(`  ${roleTag} ${bold(name)} ${dim(`— ${relativeTime(room.last_active_at)}`)}`);
      console.log(dim(`    slug: ${room.slug}`));
    }
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdRoomCreate(args, opts) {
  try {
    const api = await ApiClient.fromConfig();
    const name = args[0] || null;
    const room = await api.createRoom(name);

    console.log(green("✓") + ` Room created: ${bold(room.name || room.slug)}`);
    console.log(`  Slug:      ${room.slug}`);
    console.log(`  Admin key: ${yellow(room.admin_key)}`);
    console.log(dim("  Save this admin key — it's shown only once."));
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdLinks(args, opts) {
  const slug = opts.room || opts.r;
  if (!slug) {
    console.error(red("✖") + " Missing --room / -r flag");
    process.exit(1);
  }

  const sort = opts.sort === "hot" ? "hot" : "newest";

  try {
    const api = await ApiClient.fromConfig();
    const data = await api.listLinks(slug, sort);

    if (!data.links?.length) {
      console.log(dim("No links yet. Add one with: share-together add --room <slug> <url>"));
      return;
    }

    console.log(bold(`Links in ${slug} (${sort}):`));
    for (const link of data.links) {
      const title = link.title || link.canonical_url;
      const tags = link.tags?.length ? ` [${link.tags.join(", ")}]` : "";
      console.log(`  ${bold(title)}`);
      console.log(dim(`    ${link.source_host} · ${relativeTime(link.created_at)} · ▲${link.upvote_count} · 💬${link.reply_count}${tags}`));
      if (link.recommendation_note) {
        console.log(dim(`    "${link.recommendation_note}"`));
      }
      if (title !== link.canonical_url) {
        console.log(dim(`    ${link.canonical_url}`));
      }
    }
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdAdd(args, opts) {
  const slug = opts.room || opts.r;
  if (!slug) {
    console.error(red("✖") + " Missing --room / -r flag");
    process.exit(1);
  }

  const url = args[0];
  if (!url) {
    console.error(red("✖") + " Missing URL argument");
    process.exit(1);
  }

  const tags = opts.tag || opts.t
    ? (Array.isArray(opts.tag || opts.t) ? (opts.tag || opts.t) : [(opts.tag || opts.t)])
        .flatMap((t) => t.split(",").map((s) => s.trim()).filter(Boolean))
    : [];

  const note = opts.note || opts.n || null;

  try {
    const api = await ApiClient.fromConfig();
    const data = await api.addLink(slug, url, tags, note);

    const link = data.link;
    if (data.duplicate) {
      console.log(yellow("⚠") + ` Already shared: ${bold(link.title || link.canonical_url)}`);
    } else {
      console.log(green("✓") + ` Shared: ${bold(link.title || link.canonical_url)}`);
    }
  } catch (err) {
    console.error(wrapError(err));
    process.exit(1);
  }
}

export async function cmdConfig(args, opts) {
  if (opts.url) {
    await setBaseUrl(opts.url);
    console.log(green("✓") + ` Base URL set to: ${opts.url}`);
    return;
  }

  const config = await loadConfig();
  console.log(bold("Configuration"));
  console.log(`  Base URL:  ${config.base_url || dim("(not set)")}`);
  console.log(`  Session:   ${config.session ? green("active") + ` (expires ${config.session.expires_at || "?"})` : dim("none — run share-together login")}`);
}
