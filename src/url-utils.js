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
  "metadata.google.internal",
  "169.254.169.254",
  "metadata.tencentyun.com",
  "100.100.100.200"
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".internal",
  ".local"
];

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

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error("This host is not allowed");
  }

  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      throw new Error("This host is not allowed");
    }
  }

  if (isBlockedIp(hostname)) {
    throw new Error("Private and local network URLs are not allowed");
  }

  return url;
}

export function isBlockedIp(hostname) {
  if (hostname === "0.0.0.0") return true;

  // Handle IPv4-mapped IPv6: ::ffff:x.x.x.x
  const ipv4Mapped = hostname.match(/^\[?::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]?$/i);
  if (ipv4Mapped) {
    return isBlockedIpv4(ipv4Mapped[1]);
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return isBlockedIpv4(hostname);
  }

  const normalized = hostname.replace(/^\[|\]$/g, "");
  const lower = normalized.toLowerCase();

  if (lower === "::1" || lower === "::") return true;

  // Unique local: fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  // Link-local: fe80::/10
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;

  return false;
}

function isBlockedIpv4(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 0)
  );
}
