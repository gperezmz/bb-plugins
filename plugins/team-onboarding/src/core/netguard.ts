// Which hosts the plugin may reach for a skills source or the GitHub host.
//
// A manifest can name any git URL, and agents can install a manifest with
// the CLI, so none may point the server at itself or at its private
// network. Host names are normalised the way the WHATWG
// URL parser does it (127.1, 2130706433 and 0x7f.1 are all 127.0.0.1), and
// the server checks DNS answers again before it connects.

const USER = "[A-Za-z0-9._-]{1,64}";
const HOST = "(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*|\\[[0-9A-Fa-f:.]{2,45}\\])";
/** `ssh://[user@]host[:port]/path`: one plain user, one plain host, a numeric port. */
const SSH_URL = new RegExp(`^ssh://(?:${USER}@)?(${HOST})(?::\\d{1,5})?/[^@\\s]*$`);
/** scp-style `user@host:path`, where the path doesn't start a URL. */
const SCP_URL = new RegExp(`^${USER}@(${HOST}):(?!//)[^@\\s]*$`);

/**
 * The host of an https, ssh or scp-style git URL, from a strict grammar;
 * null for local paths and for anything outside the grammar. Deny by
 * default: a URL two parsers could read differently (a user part with `:`
 * or `@`, a backslash, userinfo in https) has no host here and is refused.
 */
export function hostOf(url: string): string | null {
  if (/[\\\s\u0000-\u001f\u007f]/.test(url)) return null;
  if (/^https:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.username !== "" || parsed.password !== "") return null;
    return normalizeHost(parsed.hostname);
  }
  const match = SSH_URL.exec(url) ?? SCP_URL.exec(url);
  return match === null ? null : normalizeHost(match[1]!);
}

/** Lowercase, no trailing dots, IPv4 in dotted form, IPv6 without brackets. */
export function normalizeHost(raw: string): string | null {
  const trimmed = raw.trim().replace(/\.+$/, "");
  if (trimmed === "") return null;
  const bracketed = trimmed.startsWith("[") ? trimmed : trimmed.includes(":") ? `[${trimmed}]` : trimmed;
  try {
    return new URL(`http://${bracketed}/`).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  } catch {
    return null;
  }
}

function ipv4Internal(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Loopback, private, link-local, CGNAT and other non-public addresses and names. */
export function isInternalHost(raw: string): boolean {
  const host = normalizeHost(raw);
  if (host === null) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4 !== null) return ipv4Internal(Number(v4[1]), Number(v4[2]));
  if (!host.includes(":")) return false;
  // IPv6: expand to eight hextets.
  const [head = "", tail = ""] = host.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = host.includes("::") ? (tail === "" ? [] : tail.split(":")) : [];
  const words = [...left, ...new Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right].map((word) => Number.parseInt(word, 16));
  if (words.length !== 8 || words.some((word) => Number.isNaN(word))) return true;
  if (words.every((word) => word === 0)) return true; // ::
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true; // ::1
  const embedsV4 =
    (words.slice(0, 5).every((word) => word === 0) && (words[5] === 0xffff || words[5] === 0)) || // ::ffff:a.b.c.d, ::a.b.c.d
    (words[0] === 0x64 && words[1] === 0xff9b) || // 64:ff9b::a.b.c.d
    (words.slice(0, 4).every((word) => word === 0) && words[4] === 0xffff && words[5] === 0); // ::ffff:0:a.b.c.d
  if (embedsV4) return ipv4Internal(words[6]! >> 8, words[6]! & 0xff);
  // 6to4 (2002:aabb:ccdd::) carries an IPv4 address in the second and third words.
  if (words[0] === 0x2002) return ipv4Internal(words[1]! >> 8, words[1]! & 0xff);
  const first = words[0]!;
  // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 old site-local, ff00::/8 multicast.
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00;
}

/** Whether a manifest or skills URL may be fetched: local paths, or a public host. */
export function isAllowedSourceUrl(url: string): boolean {
  if (/[\\\s\u0000-\u001f\u007f]/.test(url)) return false;
  if (/^(file:\/\/|\/)/i.test(url)) return true;
  const host = hostOf(url);
  return host !== null && !isInternalHost(host);
}
