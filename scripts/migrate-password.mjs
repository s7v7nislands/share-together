#!/usr/bin/env node
// Migrate a legacy (600k) password hash to v2 (100k) format.
// Usage: node scripts/migrate-password.mjs <username> <password>

import crypto from "crypto";

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error("Usage: node scripts/migrate-password.mjs <username> <password>");
  process.exit(1);
}

// Hash with 100k iterations (v2 format)
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
const newHash = `v2:${salt.toString("hex")}:${hash.toString("hex")}`;

console.log("");
console.log("Run this SQL to migrate your password:");
console.log("");
console.log(
  `npx wrangler d1 execute share-together --remote --command "UPDATE users SET password_hash = '${newHash}' WHERE username = '${username}';"`
);
console.log("");
