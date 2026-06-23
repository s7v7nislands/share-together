import { normalizeReplyBody, normalizeAuthorName } from "../src/worker.js";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Re-import from worker — these are not exported yet, so we test through the
// module boundary. Since normalizeReplyBody and normalizeAuthorName are internal,
// we export them from worker for testing.

// The worker exports are tested through the public API.
// For now, validate the behavior by importing what's available.

describe("reply helpers", () => {
  it("normalizes reply body", () => {
    // Test basic normalization
    const result = normalizeReplyBody("  Hello  world  ");
    assert.equal(result, "Hello world");
  });

  it("rejects empty reply body", () => {
    assert.equal(normalizeReplyBody(""), null);
    assert.equal(normalizeReplyBody("   "), null);
    assert.equal(normalizeReplyBody(null), null);
  });

  it("truncates long reply body", () => {
    const long = "a".repeat(2000);
    const result = normalizeReplyBody(long);
    assert.ok(result.length <= 1000);
  });

  it("creates default author name from client id", () => {
    const result = normalizeAuthorName("", "abc123-def456");
    assert.equal(result, "anon-abc123");
  });

  it("uses custom author name when provided", () => {
    const result = normalizeAuthorName("Alice", "abc123-def456");
    assert.equal(result, "Alice");
  });

  it("trims and truncates author name", () => {
    const result = normalizeAuthorName("  Bob  ", "abc123-def456");
    assert.equal(result, "Bob");

    const long = "a".repeat(50);
    const result2 = normalizeAuthorName(long, "abc123-def456");
    assert.ok(result2.length <= 32);
  });
});
