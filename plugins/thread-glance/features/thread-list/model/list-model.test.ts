// The list model: which shelf each thread is on, what a collapsed shelf keeps,
// how Project mode groups Active, and what each row knows about its children.
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/shared/settings";
import { parkedRow, settledRow, snoozedRow, type LifecycleRow } from "@/shared/lifecycle";
import { INITIAL_DEVICE_STATE, withGroupCollapsed, withParentExpanded, withShelfCollapsed, type DeviceState } from "../storage/device-state";
import { DAY, HOUR, makeThread, PROJECTS, working } from "../testing/fixtures";
import { buildModel, type ListItem, type ModelInputs } from "./list-model";

const NOW = Date.now();
const at = (ago: number) => ({ createdAt: NOW - ago, updatedAt: NOW - ago, latestAttentionAt: NOW - ago });

function inputs(patch: Partial<ModelInputs> & Pick<ModelInputs, "threads">): ModelInputs {
  return {
    projects: PROJECTS,
    lifecycle: {},
    settings: DEFAULT_SETTINGS,
    order: [],
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
    ...patch,
  };
}

const rowIds = (items: readonly ListItem[]) => items.flatMap((item) => (item.kind === "row" ? [item.threadId] : []));

describe("shelves", () => {
  it("puts pinned threads on Pinned whatever their row says, and keeps bb's pin order", () => {
    const threads = [
      makeThread({ id: "p2", isPinned: true, pinnedAt: NOW, pinSortKey: "b", ...at(DAY) }),
      makeThread({ id: "p1", isPinned: true, pinnedAt: NOW, pinSortKey: "a", ...at(DAY) }),
      makeThread({ id: "p3", isPinned: true, pinnedAt: NOW - 1, ...at(DAY) }),
    ];
    const lifecycle = { p1: settledRow(NOW, "manual") };
    const model = buildModel(inputs({ threads, lifecycle }));
    expect(model.shelves.pinned).toEqual(["p1", "p2", "p3"]);
    expect(model.pinnedWithRow).toEqual(["p1"]);
  });

  it("applies the working and inactive settings, and a woke thread stays in Active", () => {
    const threads = [
      makeThread({ id: "w", ...working, ...at(1000) }),
      makeThread({ id: "i", ...at(7 * HOUR) }),
      makeThread({ id: "woke", ...at(10 * HOUR) }),
    ];
    const lifecycle: Record<string, LifecycleRow> = { woke: snoozedRow(NOW - 60_000, NOW - 8 * HOUR) };
    const off = buildModel(inputs({ threads, lifecycle, settings: { ...DEFAULT_SETTINGS, inactiveShelf: false } }));
    expect([...off.shelves.active].sort()).toEqual(["i", "w", "woke"]);
    const on = buildModel(inputs({ threads, lifecycle, settings: { ...DEFAULT_SETTINGS, workingShelf: true } }));
    expect(on.shelves.working).toEqual(["w"]);
    expect(on.shelves.inactive).toEqual(["i"]);
    expect(on.shelves.active).toEqual(["woke"]);
    expect(on.rows.get("woke")!.woke).toBe("time");
  });

  it("keeps a thread that asks a question in Active though it has been idle for 7 hours", () => {
    const threads = [makeThread({ id: "q", hasPendingInteraction: true, ...at(7 * HOUR) })];
    expect(buildModel(inputs({ threads })).shelves.active).toEqual(["q"]);
  });

  it("holds a renamed row on the shelf it was on", () => {
    const threads = [makeThread({ id: "a", ...at(1000) })];
    const lifecycle = { a: parkedRow(NOW) };
    const model = buildModel(inputs({ threads, lifecycle, frozenShelves: new Map([["a", "active" as const]]) }));
    expect(model.shelves.active).toEqual(["a"]);
    expect(model.shelves.parked).toEqual([]);
  });

  it("shows its cards by shelf: slim on the lower shelves, folded on Working and for working threads with the setting", () => {
    const threads = [
      makeThread({ id: "w", ...working, ...at(1000) }),
      makeThread({ id: "pk", ...at(DAY) }),
      makeThread({ id: "a", ...at(1000) }),
    ];
    const lifecycle = { pk: parkedRow(NOW - 1000) };
    const plain = buildModel(inputs({ threads, lifecycle }));
    expect(plain.rows.get("w")!.card).toBe("full");
    expect(plain.rows.get("pk")!.card).toBe("slim");
    const compact = buildModel(inputs({ threads, lifecycle, settings: { ...DEFAULT_SETTINGS, compactWorkingThreads: true } }));
    expect(compact.rows.get("w")!.card).toBe("folded");
    expect(compact.rows.get("a")!.card).toBe("full");
    const shelf = buildModel(inputs({ threads, lifecycle, settings: { ...DEFAULT_SETTINGS, workingShelf: true } }));
    expect(shelf.rows.get("w")!.card).toBe("folded");
  });
});

describe("collapsed shelves", () => {
  const threads = [
    makeThread({ id: "i1", ...at(8 * HOUR) }),
    makeThread({ id: "i2", ...at(9 * HOUR) }),
    makeThread({ id: "i3", hasPendingInteraction: true, ...at(10 * HOUR) }),
    makeThread({ id: "i4", ...at(11 * HOUR), indicator: "unread-error", status: "error" }),
  ];

  it("shows a collapsed shelf's open thread and, with the setting, threads whose tree needs you or failed", () => {
    const withSetting = buildModel(inputs({ threads, activeThreadId: "i2" }));
    // i3 asks a question, so it is in Active; i4's failed turn is unread. i1 and i2 are Inactive.
    expect([...withSetting.shelves.inactive].sort()).toEqual(["i1", "i2", "i4"]);
    expect(rowIds(withSetting.lower)).toEqual(["i2", "i4"]);
    const without = buildModel(inputs({ threads, activeThreadId: "i2", settings: { ...DEFAULT_SETTINGS, showChildrenNeedingAttention: false } }));
    expect(rowIds(without.lower)).toEqual(["i2"]);
  });

  it("draws every row of an open shelf and none of a collapsed one without such threads", () => {
    const open = buildModel(inputs({ threads, device: withShelfCollapsed(INITIAL_DEVICE_STATE, "inactive", false) }));
    expect(rowIds(open.lower).sort()).toEqual(["i1", "i2", "i4"]);
    const closed = buildModel(inputs({ threads: threads.slice(0, 2) }));
    expect(rowIds(closed.lower)).toEqual([]);
    expect(closed.lower[0]).toMatchObject({ kind: "shelf", shelf: "inactive", count: 2, collapsed: true });
  });
});

describe("Project mode", () => {
  const threads = [
    makeThread({ id: "a1", projectId: "proj_a", ...at(50) }),
    makeThread({ id: "b1", projectId: "proj_b", ...at(40) }),
    makeThread({ id: "a2", projectId: "proj_a", ...at(30) }),
    makeThread({ id: "a3", projectId: "proj_a", ...at(20) }),
  ];
  const order = ["a1", "b1", "a2", "a3"];
  const project: DeviceState = { ...INITIAL_DEVICE_STATE, activeSort: "project" };

  it("groups a project with two or more Active threads where its first thread sits, and marks its rows grouped", () => {
    const model = buildModel(inputs({ threads, order, device: project }));
    expect(model.upper.map((item) => item.kind === "row" ? item.threadId : item.kind === "group" ? `[${item.projectId}]` : item.kind)).toEqual([
      "shelf",
      "[proj_a]",
      "a1",
      "a2",
      "a3",
      "b1",
    ]);
    expect(model.rows.get("a1")!.grouped).toBe(true);
    expect(model.rows.get("b1")!.grouped).toBe(false);
  });

  it("draws no group header outside Project mode", () => {
    const model = buildModel(inputs({ threads, order }));
    expect(model.upper.some((item) => item.kind === "group")).toBe(false);
    expect(model.rows.get("a1")!.grouped).toBe(false);
  });

  it("collapses a group but keeps the open thread", () => {
    const device = withGroupCollapsed(project, "proj_a", true);
    const model = buildModel(inputs({ threads, order, device, activeThreadId: "a2" }));
    expect(rowIds(model.upper)).toEqual(["a2", "b1"]);
  });

  it("lets a group move as a unit and its threads move among themselves", () => {
    const model = buildModel(inputs({ threads, order, device: project }));
    expect(model.reorderLists.get("active")!.units.map((unit) => unit.key)).toEqual(["group:proj_a", "b1"]);
    expect(model.reorderLists.get("group:proj_a")!.units.map((unit) => unit.key)).toEqual(["a1", "a2", "a3"]);
    expect(model.reorderOf.get("a2")).toEqual({ listKey: "group:proj_a", unitKey: "a2" });
    expect(model.reorderOf.get("group:proj_a")).toEqual({ listKey: "active", unitKey: "group:proj_a" });
  });
});

describe("sorts turn reordering off in Active", () => {
  const threads = [makeThread({ id: "a", ...at(1000) }), makeThread({ id: "p", isPinned: true, pinnedAt: NOW, ...at(1000) })];

  it("keeps a reorder list for Pinned only under Recent activity and Date created", () => {
    for (const activeSort of ["activity", "created"] as const) {
      const model = buildModel(inputs({ threads, device: { ...INITIAL_DEVICE_STATE, activeSort } }));
      expect([...model.reorderLists.keys()]).toEqual(["pinned"]);
    }
    expect([...buildModel(inputs({ threads })).reorderLists.keys()].sort()).toEqual(["active", "pinned"]);
  });
});

describe("children", () => {
  const tree = [
    makeThread({ id: "p", ...at(1000) }),
    makeThread({ id: "c1", parentThreadId: "p", createdAt: NOW - 500, updatedAt: NOW - 100, latestAttentionAt: NOW - 100 }),
    makeThread({ id: "c2", parentThreadId: "p", createdAt: NOW - 400, updatedAt: NOW - 400, latestAttentionAt: NOW - 400, indicator: "unread-error", status: "error" }),
    makeThread({ id: "g", parentThreadId: "c1", ...working, createdAt: NOW - 300, updatedAt: NOW - 300, latestAttentionAt: NOW - 300 }),
  ];

  it("lists each child once, under its parent, and counts the subtree for the chip", () => {
    const model = buildModel(inputs({ threads: tree }));
    expect(model.shelves.active).toEqual(["p"]);
    const parent = model.rows.get("p")!;
    expect(parent.children).toMatchObject({ ids: ["c1", "c2"], descendantCount: 3, urgency: "failed", counts: { failed: 1, working: 1, needsYou: 0, done: 0 } });
    expect(model.rows.get("c1")!.shelf).toBeNull();
    expect(model.rows.get("c1")!.children!.ids).toEqual(["g"]);
  });

  it("sorts children by the Child threads settings", () => {
    const newest = buildModel(inputs({ threads: tree, settings: { ...DEFAULT_SETTINGS, childDirection: "newest" } }));
    expect(newest.rows.get("p")!.children!.ids).toEqual(["c2", "c1"]);
    const activity = buildModel(inputs({ threads: tree, settings: { ...DEFAULT_SETTINGS, childOrder: "activity", childDirection: "newest" } }));
    expect(activity.rows.get("p")!.children!.ids).toEqual(["c1", "c2"]);
  });

  it("draws a closed child list's path to the open thread and, with the setting, children with a status; an open list draws all", () => {
    const closed = buildModel(inputs({ threads: tree }));
    expect(closed.rows.get("p")!.shownChildIds).toEqual(["c2"]);
    const noSetting = buildModel(inputs({ threads: tree, settings: { ...DEFAULT_SETTINGS, showChildrenNeedingAttention: false } }));
    expect(noSetting.rows.get("p")!.shownChildIds).toEqual([]);
    const path = buildModel(inputs({ threads: tree, activeThreadId: "g", settings: { ...DEFAULT_SETTINGS, showChildrenNeedingAttention: false } }));
    expect(path.rows.get("p")!.shownChildIds).toEqual(["c1"]);
    expect(path.rows.get("c1")!.shownChildIds).toEqual(["g"]);
    const open = buildModel(inputs({ threads: tree, device: withParentExpanded(INITIAL_DEVICE_STATE, "p", true) }));
    expect(open.rows.get("p")!.shownChildIds).toEqual(["c1", "c2"]);
    expect(open.rows.get("p")!.expanded).toBe(true);
  });

  it("works out the working shelf from the whole tree", () => {
    const model = buildModel(inputs({ threads: tree, settings: { ...DEFAULT_SETTINGS, workingShelf: true } }));
    // A child works, but another failed: the tree is working and nothing needs the user.
    expect(model.shelves.working).toEqual(["p"]);
  });

  it("makes a child of an archived parent a row of its own, and a pinned child a pinned row", () => {
    const threads = [
      makeThread({ id: "p", isArchived: true, archivedAt: NOW, ...at(1000) }),
      makeThread({ id: "c", parentThreadId: "p", ...at(1000) }),
      makeThread({ id: "q", ...at(1000) }),
      makeThread({ id: "d", parentThreadId: "q", isPinned: true, pinnedAt: NOW, ...at(1000) }),
    ];
    const model = buildModel(inputs({ threads }));
    expect([...model.shelves.active].sort()).toEqual(["c", "q"]);
    expect(model.shelves.pinned).toEqual(["d"]);
    expect(model.rows.get("q")!.children).toBeNull();
  });

  it("ends a parent chain that loops", () => {
    const threads = [makeThread({ id: "x", parentThreadId: "y", ...at(10) }), makeThread({ id: "y", parentThreadId: "x", ...at(10) })];
    const model = buildModel(inputs({ threads }));
    expect(model.shelves.active.length).toBeGreaterThan(0);
  });
});

describe("scenes", () => {
  it("says All clear when none of Pinned, Active, Working or Inactive holds a thread", () => {
    expect(buildModel(inputs({ threads: [] })).scene).toBe("all-clear");
    const parked = buildModel(inputs({ threads: [makeThread({ id: "k", ...at(DAY) })], lifecycle: { k: parkedRow(NOW - 1000) } }));
    expect(parked.scene).toBe("all-clear");
    expect(buildModel(inputs({ threads: [makeThread({ id: "a", ...at(10) })] })).scene).toBeNull();
  });

  it("shows the Working scene when the Working shelf holds every visible thread", () => {
    const threads = [makeThread({ id: "w", ...working, ...at(10) })];
    const on = { ...DEFAULT_SETTINGS, workingShelf: true };
    expect(buildModel(inputs({ threads, settings: on })).scene).toBe("working");
    expect(buildModel(inputs({ threads, settings: DEFAULT_SETTINGS })).scene).toBeNull();
    expect(buildModel(inputs({ threads: [...threads, makeThread({ id: "a", ...at(10) })], settings: on })).scene).toBeNull();
  });
});

describe("settled paging", () => {
  it("shows the first rows and offers the next page", () => {
    const threads = Array.from({ length: 40 }, (_, index) => makeThread({ id: `t${index}`, ...at(DAY) }));
    const lifecycle = Object.fromEntries(threads.map((thread, index) => [thread.id, settledRow(NOW - index * 1000, "auto")]));
    const device = withShelfCollapsed(INITIAL_DEVICE_STATE, "settled", false);
    const model = buildModel(inputs({ threads, lifecycle, device, settledShown: 10 }));
    expect(rowIds(model.lower)).toHaveLength(10);
    expect(model.lower.at(-1)).toMatchObject({ kind: "more", remaining: 30, next: 25 });
    const all = buildModel(inputs({ threads, lifecycle, device, settledShown: 60 }));
    expect(all.lower.some((item) => item.kind === "more")).toBe(false);
  });
});
