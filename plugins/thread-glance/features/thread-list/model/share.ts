// Structural sharing between two list views: whatever did not change keeps
// the previous object, so memoized rows and groups skip their render. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { GroupView, ListView, Row } from "./view";

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

/**
 * Fields bb changes when it marks a thread read, none of which the list draws
 * but through `isUnread`. A field bb starts changing on a read that is not
 * listed here only costs that update a full derive step, and the row a render.
 */
export const READ_FIELDS: ReadonlySet<string> = new Set(["lastReadAt", "isUnread", "indicator", "indicatorLabel"]);

/** Two objects of one thread that differ only in the fields a read changes. */
function onlyReadFieldsDiffer(a: PluginSidebarThread, b: PluginSidebarThread): boolean {
  const keys = Object.keys(b) as (keyof PluginSidebarThread)[];
  return keys.length === Object.keys(a).length && keys.every((key) => READ_FIELDS.has(key) || Object.is(a[key], b[key]));
}

/**
 * A row shared with its previous object. A thread row whose thread changed
 * only in read fields, with nothing it draws changed, keeps its previous
 * object: bb's reads of a thread already shown read skip the derive step, and
 * the next step must not draw the row again for them.
 */
function shareRow(before: Row, row: Row): Row {
  if (before.type === "thread" && row.type === "thread" && before.info.thread !== row.info.thread && onlyReadFieldsDiffer(before.info.thread, row.info.thread)) {
    const kept = share<Row>(before, { ...row, info: { ...row.info, thread: before.info.thread } });
    if (kept === before) return before;
  }
  return share(before, row);
}

/** Rows matched by key, so an insertion doesn't renew every row after it. */
function shareRows(previous: readonly Row[], next: Row[]): Row[] {
  const byKey = new Map(previous.map((row) => [row.key, row]));
  let same = previous.length === next.length;
  const result = next.map((row, index) => {
    const before = byKey.get(row.key);
    const shared = before === undefined ? row : shareRow(before, row);
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

/**
 * `next`, sharing every group and row that did not change since `previous`.
 * Groups match by id and rows by key, never by position. A group keeps its
 * object when its header and every row are unchanged.
 */
export function shareView(previous: ListView | null, next: ListView): ListView {
  if (previous === null) return next;
  const all = new Map([...previous.groups, ...previous.more].map((group) => [group.descriptor.id, group]));
  return shareFields(previous, next, {
    groups: shareGroups(previous.groups, all, next.groups),
    more: shareGroups(previous.more, all, next.more),
  });
}
