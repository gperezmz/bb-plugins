import { describe, expect, it } from "vitest";
import { finishedUnread, makeThread, viewOf, working, type Scenario } from "../testing/fixtures";
import { share, shareView } from "./share";
import type { ListView, ThreadRow } from "./view";

function threadRow(view: ListView, id: string): ThreadRow {
  for (const group of [...view.groups, ...view.more]) {
    for (const row of group.rows) if (row.type === "thread" && row.info.thread.id === id) return row;
  }
  throw new Error(`no row ${id}`);
}

const threads = [
  makeThread({ id: "a", createdAt: 1, updatedAt: 1 }),
  makeThread({ id: "b", createdAt: 2, updatedAt: 2 }),
  makeThread({ id: "c", createdAt: 3, updatedAt: 3, parentThreadId: "b" }),
  makeThread({ id: "d", createdAt: 4, updatedAt: 4, projectId: "proj_b" }),
];
const scenario: Scenario = { threads, prefs: { expandedChildren: ["b"], foldOlder: false } };

describe("share", () => {
  it("returns the previous value when the next deep-equals it", () => {
    const previous = { a: [1, { b: new Set(["x"]) }], c: null };
    expect(share(previous, { a: [1, { b: new Set(["x"]) }], c: null })).toBe(previous);
  });

  it("keeps the unchanged parts of a changed value", () => {
    const previous = { same: { deep: [1, 2] }, changed: { value: 1 } };
    const next = share(previous, { same: { deep: [1, 2] }, changed: { value: 2 } });
    expect(next).toEqual({ same: { deep: [1, 2] }, changed: { value: 2 } });
    expect(next).not.toBe(previous);
    expect(next.same).toBe(previous.same);
    expect(next.changed).not.toBe(previous.changed);
  });

  it("tells sets, lengths and missing keys apart", () => {
    expect(share(new Set(["a"]), new Set(["b"]))).toStrictEqual(new Set(["b"]));
    expect(share([1, 2], [1, 2, 3])).toStrictEqual([1, 2, 3]);
    expect(share<Record<string, number>>({ a: 1 }, { a: 1, b: 2 })).toStrictEqual({ a: 1, b: 2 });
    expect(share<Record<string, number | undefined>>({ a: 1, b: undefined }, { a: 1, c: undefined })).toStrictEqual({
      a: 1,
      c: undefined,
    });
  });
});

describe("shareView", () => {
  it("returns the previous view when nothing changed", () => {
    const previous = viewOf(scenario);
    expect(shareView(previous, viewOf(scenario))).toBe(previous);
  });

  it("renews only the changed row and its group", () => {
    const previous = viewOf(scenario);
    const changed = threads.map((thread) => (thread.id === "a" ? { ...thread, ...working } : thread));
    const fresh = viewOf({ ...scenario, threads: changed });
    const next = shareView(previous, fresh);
    expect(next).toEqual(fresh);
    expect(threadRow(next, "a")).not.toBe(threadRow(previous, "a"));
    expect(threadRow(next, "a").info.flags.has("working")).toBe(true);
    expect(threadRow(next, "b")).toBe(threadRow(previous, "b"));
    expect(threadRow(next, "c")).toBe(threadRow(previous, "c"));
    // Another project's group is untouched.
    const groupOf = (view: ListView, id: string) =>
      view.groups.find((group) => group.rows.some((row) => row.type === "thread" && row.info.thread.id === id))!;
    expect(groupOf(next, "d")).toBe(groupOf(previous, "d"));
    expect(groupOf(next, "a")).not.toBe(groupOf(previous, "a"));
  });

  it("keeps rows by key when a row is inserted before them", () => {
    const previous = viewOf(scenario);
    const added = [...threads, makeThread({ id: "e", createdAt: 5, updatedAt: 5 })];
    const fresh = viewOf({ ...scenario, threads: added });
    const next = shareView(previous, fresh);
    expect(next).toEqual(fresh);
    expect(threadRow(next, "e")).toBe(threadRow(fresh, "e"));
    expect(threadRow(next, "a")).toBe(threadRow(previous, "a"));
  });

  it("keeps Needs you's unchanged rows when a family joins it", () => {
    const blocked = threads.map((thread) => (thread.id === "c" ? { ...thread, hasPendingInteraction: true } : thread));
    const previous = viewOf({ ...scenario, threads: blocked });
    const added = [...blocked, makeThread({ id: "e", createdAt: 5, updatedAt: 5, ...finishedUnread })];
    const fresh = viewOf({ ...scenario, threads: added });
    const next = shareView(previous, fresh);
    expect(next).toEqual(fresh);
    const row = (view: ListView, id: string) => view.needsYou!.rows.find((candidate) => candidate.key === `thread:${id}`);
    expect(row(next, "c")).toBe(row(previous, "c"));
    expect(next.needsYou).not.toBe(previous.needsYou);
    expect(shareView(next, viewOf({ ...scenario, threads: added })).needsYou).toBe(next.needsYou);
  });
});
