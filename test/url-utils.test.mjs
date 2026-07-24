import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpUrl, isBlockedIp, normalizeUrl } from "../src/url-utils.js";

test("normalizes URLs for room-level duplicate detection", () => {
  assert.equal(
    normalizeUrl("HTTPS://Example.com/article/?b=2&utm_source=news&a=1#section"),
    "https://example.com/article?a=1&b=2"
  );
});

test("rejects non-http URLs", () => {
  assert.throws(() => normalizeUrl("file:///etc/passwd"), /Only http/);
});

test("blocks local and private network URLs", () => {
  assert.equal(isBlockedIp("127.0.0.1"), true);
  assert.equal(isBlockedIp("10.1.2.3"), true);
  assert.equal(isBlockedIp("172.16.0.1"), true);
  assert.equal(isBlockedIp("192.168.1.1"), true);
  assert.throws(() => assertPublicHttpUrl("http://localhost:8787"), /not allowed/);
});

test("blocks IPv4-mapped IPv6 addresses", () => {
  assert.equal(isBlockedIp("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedIp("[::ffff:10.0.0.1]"), true);
  assert.equal(isBlockedIp("::ffff:192.168.1.1"), true);
});

test("blocks IPv6 unique-local and link-local addresses", () => {
  assert.equal(isBlockedIp("fc00::1"), true);
  assert.equal(isBlockedIp("fd12:3456::1"), true);
  assert.equal(isBlockedIp("fe80::1"), true);
});
