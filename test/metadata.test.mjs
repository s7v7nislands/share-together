import test from "node:test";
import assert from "node:assert/strict";
import { extractMetadata } from "../src/metadata.js";

test("extracts Open Graph metadata", () => {
  const meta = extractMetadata(`
    <html>
      <head>
        <meta property="og:title" content="A useful article">
        <meta property="og:description" content="Short summary">
        <meta property="og:image" content="/cover.jpg">
      </head>
    </html>
  `, "https://example.com/posts/1");

  assert.equal(meta.title, "A useful article");
  assert.equal(meta.description, "Short summary");
  assert.equal(meta.image_url, "https://example.com/cover.jpg");
});

test("falls back to title tag", () => {
  const meta = extractMetadata("<title>Plain page &amp; title</title>", "https://example.com");
  assert.equal(meta.title, "Plain page & title");
});
