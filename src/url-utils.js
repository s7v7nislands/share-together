const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "spm"
]);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal"
]);

export function normalizeUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();

  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
      parsed.searchParams.delete(key);
    }
  }

  parsed.searchParams.sort();

  if ((parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")) {
    parsed.port = "";
  }

  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

export function getSourceHost(input) {
  return new URL(input).hostname.replace(/^www\./, "");
}

export function assertPublicHttpUrl(input) {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("This host is not allowed");
  }

  if (isBlockedIp(hostname)) {
    throw new Error("Private and local network URLs are not allowed");
  }

  return url;
}

export function isBlockedIp(hostname) {
  if (hostname === "0.0.0.0") return true;

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return true;
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::" || normalized.toLowerCase().startsWith("fc") || normalized.toLowerCase().startsWith("fd")) {
    return true;
  }

  return false;
}
