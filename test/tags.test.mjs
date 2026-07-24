import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiSummary, normalizeRecommendationNote, normalizeTags, parseTags } from "../src/worker.js";

test("normalizes submitted tags", () => {
  assert.deepEqual(
    normalizeTags([" #News ", "news", "Long   form", "", 42, "#Tools"]),
    ["News", "Long form", "Tools"]
  );
});

test("limits stored tags", () => {
  assert.deepEqual(
    normalizeTags("a,b,c,d,e,f,g,h,i"),
    ["a", "b", "c", "d", "e", "f", "g", "h"]
  );
});

test("parses persisted tags safely", () => {
  assert.deepEqual(parseTags("[\"News\",\"news\",\"Design\"]"), ["News", "Design"]);
  assert.deepEqual(parseTags("not json"), []);
});

test("normalizes recommendation notes", () => {
  assert.equal(normalizeRecommendationNote("  Useful   framing\nfor the topic.  "), "Useful framing for the topic.");
  assert.equal(normalizeRecommendationNote("   "), null);
  assert.equal(normalizeRecommendationNote(null), null);
  assert.equal(normalizeRecommendationNote("x".repeat(300)).length, 280);
});

test("normalizes AI summaries", () => {
  assert.equal(normalizeAiSummary("  A concise   summary\nof the article.  "), "A concise summary of the article.");
  assert.equal(normalizeAiSummary("   "), null);
  assert.equal(normalizeAiSummary(null), null);
  assert.equal(normalizeAiSummary("x".repeat(1100)).length, 1000);
});
