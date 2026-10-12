// Scrubbing text of credentials before it is recorded or shown: the tokens
// the plugin holds, and the shapes a token takes in a header or a query.

const REDACTED = "[redacted]";
const MIN_SECRET_LENGTH = 6;
const MAX_MESSAGE_LENGTH = 300;

const HEADER_NAMES = "authorization|proxy-authorization|private-token";
/** A header written in quotes, as in a JSON dump or an object printed by Node. */
const QUOTED_HEADER = new RegExp(`(\\b(?:${HEADER_NAMES})["']?\\s*[:=]\\s*)(["'])[^"'\\r\\n]*\\2`, "gi");
/** A header written bare, as in `Authorization: Bearer abc`: its value runs to the end of the line or the next separator. */
const BARE_HEADER = new RegExp(`(\\b(?:${HEADER_NAMES})["']?\\s*[:=]\\s*)(?![\\s"'])[^\\r\\n,;}]*`, "gi");
const SCHEME = /\b(Bearer|Basic)\s+\S+/gi;
const QUERY_TOKEN = /\b([A-Za-z0-9_.-]*token)=[^&\s"'#]+/gi;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces with `[redacted]` every occurrence of each secret of six
 * characters or more (also as it reads URL-encoded or inside a JSON string),
 * the value of an `Authorization`, `Proxy-Authorization` or `Private-Token`
 * header, anything after `Bearer` or `Basic`, and the value of a `token=`,
 * `access_token=` or `private_token=` query parameter. Redacting redacted
 * text changes nothing.
 */
export const redact = (text: string, secrets: readonly string[]): string => {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    variants.add(JSON.stringify(secret).slice(1, -1));
  }
  const known = [...variants].filter((variant) => variant.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length);
  let result = known.length === 0 ? text : text.replace(new RegExp(known.map(escapeRegExp).join("|"), "g"), REDACTED);
  result = result.replace(QUOTED_HEADER, `$1$2${REDACTED}$2`);
  result = result.replace(BARE_HEADER, `$1${REDACTED}`);
  result = result.replace(SCHEME, `$1 ${REDACTED}`);
  return result.replace(QUERY_TOKEN, `$1=${REDACTED}`);
};

/** An error's message (or its string form), redacted, on one line, cut to 300 characters. */
export const messageOf = (error: unknown, secrets: readonly string[]): string => {
  let message: string;
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = "unprintable error";
  }
  return redact(message, secrets).replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
};
