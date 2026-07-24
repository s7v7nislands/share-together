const MAX_HTML_BYTES = 256 * 1024;

export async function fetchMetadata(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "ShareTogetherBot/0.1 (+https://example.com)"
      }
    });

    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.toLowerCase().includes("html")) {
      return { status: "failed" };
    }

    const reader = response.body?.getReader();
    if (!reader) return { status: "failed" };

    const chunks = [];
    let received = 0;
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    await reader.cancel().catch(() => {});

    const html = new TextDecoder().decode(concatChunks(chunks, Math.min(received, MAX_HTML_BYTES)));
    return {
      status: "parsed",
      ...extractMetadata(html, url)
    };
  } catch {
    return { status: "failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export function extractMetadata(html, baseUrl) {
  const meta = collectMeta(html);
  const title = firstNonEmpty(
    meta["og:title"],
    meta["twitter:title"],
    textBetween(html, /<title[^>]*>/i, /<\/title>/i)
  );
  const description = firstNonEmpty(
    meta["og:description"],
    meta["twitter:description"],
    meta.description
  );
  const image = firstNonEmpty(meta["og:image"], meta["twitter:image"], meta["twitter:image:src"]);

  return {
    title: title ? decodeEntities(title).trim().slice(0, 300) : null,
    description: description ? decodeEntities(description).trim().slice(0, 600) : null,
    image_url: image ? absolutizeUrl(decodeEntities(image).trim(), baseUrl) : null
  };
}

function collectMeta(html) {
  const result = {};
  const re = /<meta\s+[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const tag = match[0];
    const key = attr(tag, "property") || attr(tag, "name");
    const content = attr(tag, "content");
    if (key && content && !result[key.toLowerCase()]) {
      result[key.toLowerCase()] = content;
    }
  }
  return result;
}

function attr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(re);
  return match?.[2] || match?.[3] || match?.[4] || null;
}

function textBetween(html, startRe, endRe) {
  const start = html.search(startRe);
  if (start < 0) return null;
  const afterStart = html.slice(start).match(startRe)?.[0].length || 0;
  const rest = html.slice(start + afterStart);
  const end = rest.search(endRe);
  return end < 0 ? null : rest.slice(0, end);
}

function firstNonEmpty(...values) {
  return values.find((value) => value && value.trim()) || null;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absolutizeUrl(value, baseUrl) {
  try {
    const resolved = new URL(value, baseUrl);
    // Only allow http/https image URLs — reject data: javascript: etc.
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function concatChunks(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.slice(0, Math.max(0, totalLength - offset));
    output.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= totalLength) break;
  }
  return output;
}
