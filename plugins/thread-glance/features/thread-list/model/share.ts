// Structural sharing between two list views: whatever did not change keeps
// the previous object, so memoized rows and groups skip their render. Pure.
import type { GroupView, ListView, NeedsYouView, Row } from "./view";

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
 * primitives by membership, anything else by identity.
 */
export function share<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    const result = next.map((value, index) => {
      const shared = index < previous.length ? share(previous[index], value) : value;
      if (shared !== previous[index]) same = false;
      return shared;
    });
    return (same ? previous : result) as T;
  }
  if (previous instanceof Set && next instanceof Set) return (sameSet(previous, next) ? previous : next) as T;
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (!(key in previous)) same = false;
      const shared = key in previous ? share(previous[key], next[key]) : next[key];
      if (shared !== previous[key]) same = false;
      result[key] = shared;
    }
    return (same ? previous : result) as T;
  }
  return next;
}

/** Rows matched by key, so an insertion doesn't renew every row after it. */
function shareRows(previous: readonly Row[], next: Row[]): Row[] {
  const byKey = new Map(previous.map((row) => [row.key, row]));
  let same = previous.length === next.length;
  const result = next.map((row, index) => {
    const before = byKey.get(row.key);
    const shared = before === undefined ? row : share(before, row);
    if (shared !== previous[index]) same = false;
    return shared;
  });
  return same ? (previous as Row[]) : result;
}

/** `next` with each field shared from `previous`; `previous` when every field is. */
function shareFields<T extends object>(previous: T, next: T, shared: Partial<T>): T {
  const result = { ...next } as Record<string, unknown>;
  const before = previous as Record<string, unknown>;
  let same = Object.keys(result).length === Object.keys(before).length;
  for (const key of Object.keys(result)) {
    if (!(key in before)) same = false;
    result[key] = key in shared ? (shared as Record<string, unknown>)[key] : share(before[key], result[key]);
    if (result[key] !== before[key]) same = false;
  }
  return same ? previous : (result as T);
}

function sameItems<T>(previous: readonly T[], next: readonly T[]): boolean {
  return previous.length === next.length && next.every((item, index) => item === previous[index]);
}

function shareGroups(previousGroups: GroupView[], all: ReadonlyMap<string, GroupView>, next: GroupView[]): GroupView[] {
  const result = next.map((group) => {
    const before = all.get(group.descriptor.id);
    if (before === undefined) return group;
    return shareFields(before, group, { rows: shareRows(before.rows, group.rows) });
  });
  return sameItems(previousGroups, result) ? previousGroups : result;
}

function shareNeedsYou(previous: NeedsYouView | null, next: NeedsYouView | null): NeedsYouView | null {
  if (previous === null || next === null) return next;
  return shareFields(previous, next, { rows: shareRows(previous.rows, next.rows) });
}

/**
 * `next`, sharing every group and row that did not change since `previous`.
 * Groups match by id and rows by key, never by position. A group keeps its
 * object when its header and every row are unchanged.
 */
export function shareView(previous: ListView | null, next: ListView): ListView {
  if (previous === null) return next;
  const all = new Map([...previous.groups, ...previous.more].map((group) => [group.descriptor.id, group]));
  return shareFields(previous, next, {
    needsYou: shareNeedsYou(previous.needsYou, next.needsYou),
    groups: shareGroups(previous.groups, all, next.groups),
    more: shareGroups(previous.more, all, next.more),
  });
}
