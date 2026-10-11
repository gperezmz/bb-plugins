// The layout of the list's items and the windowing over it.
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/shared/settings";
import { INITIAL_DEVICE_STATE, withParentExpanded } from "../storage/device-state";
import { makeThread, PROJECTS } from "@/testing/fixtures";
import { heightsFor } from "./heights";
import { itemIndexAt, itemsBetween, layoutItems, rowHeight } from "./layout";
import { buildModel } from "./list-model";
import { keptIndexes, mountedIndexes, rangeKey, windowedNavValue } from "./windowing";

const NOW = Date.now();
const heights = heightsFor(false);
const threads = Array.from({ length: 100 }, (_, index) =>
  makeThread({ id: `t${index}`, createdAt: NOW - 1000 - index, updatedAt: NOW - 1000, latestAttentionAt: NOW - 1000 }),
);
const model = buildModel({
  threads,
  projects: PROJECTS,
  lifecycle: {},
  settings: DEFAULT_SETTINGS,
  order: threads.map((thread) => thread.id),
  device: INITIAL_DEVICE_STATE,
  scopeId: null,
  activeThreadId: null,
  draftIds: new Set(),
  openElsewhereIds: new Set(),
  now: NOW,
  compact: false,
  settledShown: 10,
  frozenShelves: new Map(),
  pinnedOverride: null,
  drag: null,
});

describe("layout", () => {
  const layout = layoutItems(model.upper, model.rows, heights);

  it("puts each item under the one before it, from the heights model", () => {
    expect(layout.items[0]!.item.kind).toBe("shelf");
    expect(layout.items[0]!.size).toBe(heights.shelfHeader);
    expect(layout.items[1]!.start).toBe(heights.shelfHeader);
    expect(layout.items[1]!.size).toBe(heights.fullCard);
    expect(layout.height).toBe(heights.shelfHeader + 100 * heights.fullCard);
  });

  it("gives every shelf header but the first the gap above it", () => {
    const withTwo = layoutItems(
      [
        { kind: "shelf", key: "s1", shelf: "pinned", count: 0, collapsed: false, spinning: false },
        { kind: "shelf", key: "s2", shelf: "active", count: 0, collapsed: false, spinning: false },
      ],
      model.rows,
      heights,
    );
    expect(withTwo.items[1]!.size).toBe(heights.shelfHeader + heights.shelfGap);
  });

  it("counts the children drawn under a card in its height", () => {
    const parent = makeThread({ id: "p", createdAt: NOW - 1000, updatedAt: NOW - 1000, latestAttentionAt: NOW - 1000 });
    const kids = ["c1", "c2"].map((id) => makeThread({ id, parentThreadId: "p", createdAt: NOW - 500, updatedAt: NOW - 500, latestAttentionAt: NOW - 500 }));
    const open = buildModel({
      threads: [parent, ...kids],
      projects: PROJECTS,
      lifecycle: {},
      settings: DEFAULT_SETTINGS,
      order: [],
      device: withParentExpanded(INITIAL_DEVICE_STATE, "p", true),
      scopeId: null,
      activeThreadId: null,
      draftIds: new Set(),
      openElsewhereIds: new Set(),
      now: NOW,
      compact: false,
      settledShown: 10,
      frozenShelves: new Map(),
      pinnedOverride: null,
      drag: null,
    });
    expect(rowHeight(open.rows, "p", heights)).toBe(heights.fullCard + 2 * heights.childRow);
  });

  it("finds the item at a height and the items in a range", () => {
    expect(itemIndexAt(layout.items, 0)).toBe(0);
    expect(itemIndexAt(layout.items, heights.shelfHeader)).toBe(1);
    expect(itemIndexAt(layout.items, -1)).toBe(-1);
    expect(itemIndexAt(layout.items, layout.height)).toBe(-1);
    expect(itemsBetween(layout.items, heights.shelfHeader + heights.fullCard, heights.shelfHeader + 3 * heights.fullCard)).toEqual({ first: 2, last: 3 });
    expect(itemsBetween(layout.items, 5, 5)).toBeNull();
  });
});

describe("windowing", () => {
  const layout = layoutItems(model.upper, model.rows, heights);

  it("mounts the items in view with a margin, and the kept ones wherever they are", () => {
    const near = mountedIndexes(layout, { top: 0, height: 600 }, []);
    expect(near[0]).toBe(0);
    expect(near.length).toBeLessThan(20);
    const kept = keptIndexes(layout, { itemKeys: ["row:t90"] }, false);
    const withKept = mountedIndexes(layout, { top: 0, height: 600 }, kept);
    expect(withKept).toContain(layout.indexOf.get("row:t90"));
  });

  it("mounts only the kept rows before the view is known", () => {
    expect(mountedIndexes(layout, null, [3])).toEqual([3]);
    expect(rangeKey(layout, null)).toBe("");
  });

  it("keeps the first nine rows mounted for bb's jump keys", () => {
    const kept = keptIndexes(layout, { itemKeys: [] }, true);
    expect(kept).toHaveLength(9);
    expect(keptIndexes(layout, { itemKeys: [] }, false)).toEqual([]);
  });

  it("names the threads a spacer stands in for in bb's format", () => {
    expect(windowedNavValue([{ threadId: "a", projectId: "p" }, { threadId: "b", projectId: "q" }])).toBe("a:p b:q");
  });

  it("changes its range key only when the mounted range does", () => {
    expect(rangeKey(layout, { top: 0, height: 600 })).toBe(rangeKey(layout, { top: 1, height: 600 }));
    expect(rangeKey(layout, { top: 0, height: 600 })).not.toBe(rangeKey(layout, { top: 5000, height: 600 }));
  });
});
