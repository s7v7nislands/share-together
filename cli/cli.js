#!/usr/bin/env node

import {
  cmdLogin, cmdRegister, cmdLogout, cmdWhoami,
  cmdRooms, cmdRoomCreate,
  cmdLinks, cmdAdd,
  cmdConfig
} from "./lib/commands.js";

// ── argument parsing ──

function parseArgs(argv) {
  const args = [];
  const opts = {};

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        const key = arg.slice(2, eq);
        const val = arg.slice(eq + 1);
        opts[key] = val;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        // boolean flags with no value
        if (next && !next.startsWith("-")) {
          // collect multi-value for --tag/-t
          const existing = opts[key];
          if (existing !== undefined) {
            opts[key] = Array.isArray(existing) ? [...existing, next] : [existing, next];
          } else {
            opts[key] = next;
          }
          i++;
        } else {
          opts[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const flag = arg[1];
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        const existing = opts[flag];
        if (existing !== undefined) {
          opts[flag] = Array.isArray(existing) ? [...existing, next] : [existing, next];
        } else {
          opts[flag] = next;
        }
        i++;
      } else {
        opts[flag] = true;
      }
    } else {
      args.push(arg);
    }
    i++;
  }

  // normalize short flags to long names
  if (opts.r !== undefined && opts.room === undefined) opts.room = opts.r;
  if (opts.t !== undefined && opts.tag === undefined) opts.tag = opts.t;
  if (opts.n !== undefined && opts.note === undefined) opts.note = opts.n;

  return { args, opts };
}

function showHelp() {
  console.log(`share-together — CLI for managing shared links

Usage:
  share-together <command> [args] [options]

Commands:
  login     [username] [password]    Log in with username/password
  register  [username] [password]    Register a new account
  logout                             Log out

  whoami                             Show current user

  rooms                              List your rooms
  room create [name]                 Create a new room

  links     --room <slug>            List links in a room
  add       --room <slug> <url>      Add a share URL to a room

  config    [--url <base_url>]       Show or set configuration

Options:
  --room, -r <slug>    Room slug (for links, add)
  --sort <newest|hot>  Link sort order (links) [default: newest]
  --tag, -t <tag>      Tag(s) for the link (add), repeatable or comma-separated
  --note, -n <text>    Recommendation note (add)

Examples:
  share-together config --url https://share.example.com
  share-together login alice
  share-together room create "Book Club"
  share-together add --room room-abc123 https://example.com/article -t tech,blog -n "Great read"
  share-together links -r room-abc123 --sort hot
`);
}

// ── main ──

const { args, opts } = parseArgs(process.argv);

if (opts.help || opts.h) {
  showHelp();
  process.exit(0);
}

const command = args[0];
const rest = args.slice(1);

switch (command) {
  case "login":
    await cmdLogin(rest, opts);
    break;
  case "register":
    await cmdRegister(rest, opts);
    break;
  case "logout":
    await cmdLogout(rest, opts);
    break;
  case "whoami":
    await cmdWhoami(rest, opts);
    break;
  case "rooms":
    await cmdRooms(rest, opts);
    break;
  case "room": {
    const sub = rest[0];
    const subRest = rest.slice(1);
    if (sub === "create") {
      await cmdRoomCreate(subRest, opts);
    } else {
      console.error(`Unknown sub-command: room ${sub || ""}`);
      console.error("  Usage: share-together room create [name]");
      process.exit(1);
    }
    break;
  }
  case "links":
    await cmdLinks(rest, opts);
    break;
  case "add":
    await cmdAdd(rest, opts);
    break;
  case "config":
    await cmdConfig(rest, opts);
    break;
  default:
    if (command && command !== "help") {
      console.error(`Unknown command: ${command}`);
    }
    showHelp();
    process.exit(command ? 1 : 0);
}
