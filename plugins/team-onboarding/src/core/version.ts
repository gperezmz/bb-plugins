/** Compares dotted numeric versions: `2.60` < `2.101.0`. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    (/\d+(?:\.\d+)*/.exec(value)?.[0] ?? "0").split(".").map((part) => Number.parseInt(part, 10));
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
