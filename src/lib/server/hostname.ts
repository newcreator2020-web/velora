import "server-only";

export const HOSTNAME_STRICT_MAX_LEN = 253;
export const HOSTNAME_LABEL_MAX_LEN = 63;

const STRICT_LDH_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

const REJECT_PREFIXES: ReadonlyArray<`${string}://`> = [
  "http://",
  "https://",
  "ftp://",
  "ftps://",
  "sftp://",
  "ssh://",
  "telnet://",
  "file://",
  "ws://",
  "wss://",
  "smtp://",
  "imap://",
  "pop3://",
  "ldap://",
  "ldaps://",
];

const RESERVED_TLDS: ReadonlySet<string> = new Set([
  "test",
  "example",
  "invalid",
  "localhost",
  "local",
  "localdomain",
  "internal",
  "home",
  "lan",
  "corp",
  "priv",
  "intranet",
  "private",
  "office",
  "ad",
  "loc",
  "site",
  "box",
  "arpa",
  "onion",
]);

const INTERNAL_SUFFIXES: ReadonlyArray<string> = [
  ".svc.cluster.local",
  ".cluster.local",
  ".compute.internal",
  ".ec2.internal",
  ".us-east-1.compute.internal",
  ".us-west-2.compute.internal",
  ".eu-west-1.compute.internal",
  ".prod",
  ".staging",
  ".dev",
  ".uat",
];

function looksLikeIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (p.length === 0 || p.length > 3) return false;
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function looksLikeIpv6(s: string): boolean {
  if (s.includes(":") || s.startsWith("[") || s.endsWith("]")) return true;
  return false;
}

export function normalizeHostnameStrict(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();

  for (const proto of REJECT_PREFIXES) {
    if (lower.startsWith(proto)) return null;
  }

  if (/[:/?#\s@&=+[\]\\'"<>`;,(){}|^%!]/.test(lower)) return null;

  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7F]*$/.test(trimmed)) return null;

  let h = lower;
  const colonIdx = h.indexOf(":");
  if (colonIdx >= 0) return null;

  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.length === 0) return null;
  if (h.length > HOSTNAME_STRICT_MAX_LEN) return null;

  if (h === "localhost") return null;
  if (h.endsWith(".localhost")) return null;

  if (looksLikeIpv4(h) || looksLikeIpv6(h)) return null;

  if (!STRICT_LDH_RE.test(h)) return null;

  const labels = h.split(".");
  if (labels.length < 2) return null;
  for (const lab of labels) {
    if (lab.length === 0 || lab.length > HOSTNAME_LABEL_MAX_LEN) return null;
  }

  const tld = labels[labels.length - 1];
  if (!tld) return null;
  if (!/[a-z]/.test(tld)) return null;

  return h;
}

export function isPublicHostnameProductionSafe(normalized: string): boolean {
  if (typeof normalized !== "string" || normalized.length === 0) return false;
  if (normalized !== normalizeHostnameStrict(normalized)) return false;

  const labels = normalized.split(".");
  if (labels.length < 2) return false;

  const tld = labels[labels.length - 1];
  if (!tld) return false;
  if (RESERVED_TLDS.has(tld)) return false;

  for (const suff of INTERNAL_SUFFIXES) {
    if (normalized.endsWith(suff)) return false;
  }

  if (normalized.startsWith("10.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return false;
  if (normalized.startsWith("192.168.")) return false;
  if (normalized.startsWith("127.")) return false;
  if (normalized.startsWith("169.254.")) return false;
  if (normalized.startsWith("100.64.")) return false;
  if (normalized.startsWith("fd00:")) return false;
  if (normalized.startsWith("fe80:")) return false;

  const firstLabel = labels[0];
  if (!firstLabel) return false;
  if (firstLabel === "_acme-challenge" || labels.some((l) => l && l.startsWith("_"))) {
    return false;
  }

  for (const lab of labels) {
    if (!lab) return false;
    if (lab.startsWith("-") || lab.endsWith("-")) return false;
  }

  return true;
}
