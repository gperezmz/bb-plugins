// Reducing text written on a service to the little the plugin may keep of it.

/** The most code points of a body's last line that are kept. */
export const LAST_LINE_MAX = 500;

/**
 * The last non-blank line of a body, trimmed and cut to 500 code points (never
 * through a surrogate pair); null where the body is missing or blank. Lines
 * split on `\r\n`, `\r` and `\n`. This is the only part of a comment or review
 * body the plugin reads, to test it against the marker, and it is never sent
 * or stored.
 */
export const lastLine = (body: string | null | undefined): string | null => {
  if (body === null || body === undefined) return null;
  const lines = body.split(/\r\n|\r|\n/);
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at]!.trim();
    if (line !== "") return Array.from(line).slice(0, LAST_LINE_MAX).join("");
  }
  return null;
};

/** `text` cut to `max` code points, ending in `…` where it was cut (never through a surrogate pair). */
export const clip = (text: string, max: number): string => {
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max - 1).join("")}…`;
};
