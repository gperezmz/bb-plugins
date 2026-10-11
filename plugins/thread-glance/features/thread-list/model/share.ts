// Structural sharing between two list models: whatever did not change keeps
// the previous object, so memoized rows skip their render. Pure.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sameSet(previous: ReadonlySet<unknown>, next: ReadonlySet<unknown>): boolean {
  if (previous.size !== next.size) return false;
  for (const value of next) if (!previous.has(value)) return false;
  return true;
}

/**
 * Returns `next` with every part that deep-equals the same part of
 * `previous` replaced by the previous object; `previous` itself when the two
 * are equal. Plain objects and arrays are compared by value, sets of
 * primitives by membership, anything else by identity. Nothing is allocated
 * until a difference is found, since most of a list is unchanged each time.
 */
export function share<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let result: unknown[] | null = previous.length === next.length ? null : [];
    for (let index = 0; index < next.length; index += 1) {
      const shared = index < previous.length ? share(previous[index], next[index]) : next[index];
      if (result === null && shared !== previous[index]) result = previous.slice(0, index);
      result?.push(shared);
    }
    return (result ?? previous) as T;
  }
  if (previous instanceof Set && next instanceof Set) return (sameSet(previous, next) ? previous : next) as T;
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let result: Record<string, unknown> | null = null;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const known = key in previous;
      const shared = known ? share(previous[key], next[key]) : next[key];
      if (result === null && (!known || shared !== previous[key])) {
        result = {};
        for (const before of keys.slice(0, index)) result[before] = previous[before];
      }
      if (result !== null) result[key] = shared;
    }
    if (result === null && keys.length !== Object.keys(previous).length) {
      result = {};
      for (const key of keys) result[key] = previous[key];
    }
    return (result ?? previous) as T;
  }
  return next;
}
