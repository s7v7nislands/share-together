// Shared validation/normalization utilities.
// Separated from worker.js so tests can import without pulling in WASM deps.

export function validatePassword(value) {
  if (typeof value !== "string") return false;
  return value.length >= 8 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
}

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 32);
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return null;
  return name;
}

export function normalizeRoomName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 64);
  return name || null;
}

export function normalizeTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const seen = new Set();
  const tags = [];
  for (const rawTag of rawTags) {
    if (typeof rawTag !== "string") continue;
    const tag = rawTag.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

export function parseTags(value) {
  if (!value) return [];
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? normalizeTags(tags) : [];
  } catch {
    return [];
  }
}

export function normalizeRecommendationNote(value) {
  if (typeof value !== "string") return null;
  const note = value.trim().replace(/\s+/g, " ").slice(0, 280);
  return note || null;
}

export function normalizeAiSummary(value) {
  if (typeof value !== "string") return null;
  const summary = value.trim().replace(/\s+/g, " ").slice(0, 1000);
  return summary || null;
}

export function normalizeReplyBody(value) {
  if (typeof value !== "string") return null;
  const body = value.trim().replace(/\s+/g, " ").slice(0, 1000);
  return body || null;
}

export function normalizeAuthorName(value, userId) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().replace(/\s+/g, " ").slice(0, 32);
  }
  return `anon-${userId.slice(0, 6)}`;
}
