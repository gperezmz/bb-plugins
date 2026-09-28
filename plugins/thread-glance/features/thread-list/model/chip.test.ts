import { describe, expect, it } from "vitest";
import { attentionRootIds, failedUnread, finishedUnread, makeThread, T0, viewOf, working, type Scenario } from "../testing/fixtures";
import type { OlderRow, ThreadRow } from "./view";
import { treeState, type StateKind } from "./state";

function rowsOf(scenario: Scenario) {
  return viewOf(scenario).groups.find((group) => group.descriptor.id === "project:proj_a")!.rows;
}
function row(scenario: Scenario, id: string): ThreadRow {
  const found = rowsOf(scenario).find((candidate): candidate is ThreadRow => candidate.type === "thread" && candidate.info.thread.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
}

const parent = makeThread({ id: "p" });
const child = (id: string, overrides: Omit<Parameters<typeof makeThread>[0], "id"> = {}, parentId = "p") =>
  makeThread({ id, parentThreadId: parentId, createdAt: T0 + id.length, ...overrides });

describe("a parent's status glyph", () => {
  // The six states a collapsed parent's glyph can take from its tree, most urgent first.
  const RANKED: [StateKind, Omit<Parameters<typeof makeThread>[0], "id">][] = [
    ["waits-on-you", { hasPendingInteraction: true }],
    ["failed", failedUnread],
    ["queue-failed", { queuedWork: "failed" }],
    ["offline", { status: "active", runtimeStatus: "waiting-for-host" }],
    ["working", working],
    ["unread", finishedUnread],
  ];
  const shownKind = (shown: ThreadRow) => (shown.treeFlag === null ? shown.info.state.kind : treeState(shown.treeFlag).kind);

  for (const [ownRank, [own, ownOverrides]] of RANKED.entries()) {
    for (const [childRank, [kid, kidOverrides]] of RANKED.entries()) {
      it(`collapsed, parent ${own} and child ${kid}: shows ${childRank < ownRank ? kid : own}`, () => {
        const shown = row({ threads: [makeThread({ id: "p", ...ownOverrides }), child("c", kidOverrides)] }, "p");
        expect(shown.info.state.kind).toBe(own);
        expect(shownKind(shown)).toBe(childRank < ownRank ? kid : own);
        expect(shown.treeFlag !== null).toBe(childRank < ownRank);
      });
    }
  }

  it("ranks the tree's state against the parent's own by the states table, so background work outranks an unread child and a draft does not", () => {
    const unreadChild = child("c", finishedUnread);
    expect(row({ threads: [makeThread({ id: "p", activity: { backgroundAgents: 1 } }), unreadChild] }, "p").treeFlag).toBeNull();
    expect(row({ threads: [parent, unreadChild], draftIds: ["p"] }, "p").treeFlag).toBe("unread");
  });

  it("is the parent's own state while expanded", () => {
    const shown = row({ threads: [parent, child("c", working)], prefs: { expandedChildren: ["p"] } }, "p");
    expect(shown.treeFlag).toBeNull();
    expect(shown.info.state.kind).toBe("idle");
  });
});

describe("the states a collapsed parent takes from its tree", () => {
  const dot = (...children: ReturnType<typeof makeThread>[]) => row({ threads: [parent, ...children] }, "p").treeFlag;

  it("takes the first of waits on you, failed, queued message failed, offline, working, unread among the descendants", () => {
    const every = [
      child("u", finishedUnread),
      child("w", working),
      child("o", { status: "active", runtimeStatus: "waiting-for-host" }),
      child("q", { queuedWork: "failed" }),
      child("f", failedUnread),
      child("a", { hasPendingInteraction: true }),
    ];
    expect(dot(...every)).toBe("waits-on-you");
    expect(dot(...every.slice(0, 5))).toBe("unread-failed");
    expect(dot(...every.slice(0, 4))).toBe("queue-failed");
    expect(dot(...every.slice(0, 3))).toBe("offline");
    expect(dot(...every.slice(0, 2))).toBe("working");
    expect(dot(...every.slice(0, 1))).toBe("unread");
  });

  it("is absent when no descendant is in any of those, a read failure included", () => {
    expect(dot(child("c"))).toBeNull();
    expect(dot(child("c", { status: "error" }))).toBeNull();
    expect(dot(child("c", { queuedWork: "waiting" }))).toBeNull();
    expect(row({ threads: [parent] }, "p").treeFlag).toBeNull();
  });

  it("reads descendants at any depth", () => {
    expect(dot(child("c"), child("g", { hasPendingInteraction: true }, "c"))).toBe("waits-on-you");
    expect(row({ threads: [parent, child("c"), child("g", working, "c")], prefs: { expandedChildren: ["p"] } }, "c").treeFlag).toBe("working");
  });

  it("leaves archived descendants out", () => {
    expect(dot(child("c", { ...working, isArchived: true, archivedAt: T0 }))).toBeNull();
  });

  it("takes only waits on you, failed, queued message failed and offline from a hidden descendant, and leaves what needs attention unchanged", () => {
    const hidden = (overrides: Omit<Parameters<typeof makeThread>[0], "id">) => child("h", { isHidden: true, ...overrides });
    expect(dot(hidden(working))).toBeNull();
    expect(dot(hidden(finishedUnread))).toBeNull();
    expect(dot(hidden({ hasPendingInteraction: true }))).toBe("waits-on-you");
    expect(dot(hidden(failedUnread))).toBe("unread-failed");
    expect(dot(hidden({ queuedWork: "failed" }))).toBe("queue-failed");
    expect(dot(hidden({ status: "active", runtimeStatus: "waiting-for-host" }))).toBe("offline");
    // A hidden offline or queue-failed thread still makes nothing need attention, as before.
    expect(attentionRootIds({ threads: [parent, hidden({ status: "active", runtimeStatus: "waiting-for-host" })] })).toEqual([]);
    expect(attentionRootIds({ threads: [parent, hidden({ queuedWork: "failed" })] })).toEqual([]);
  });
});

describe("the children chip", () => {
  // Five children, two of them with children of their own, and a hidden one.
  const threads = [
    parent,
    ...["a", "bb", "ccc", "dddd", "eeeee"].map((id) => child(id)),
    child("a1", {}, "a"),
    child("a2", {}, "a"),
    child("ccc1", {}, "ccc"),
    child("hid", { isHidden: true }),
  ];

  it("counts the direct children, hidden ones left out, not every descendant", () => {
    expect(row({ threads }, "p").chip).toEqual({ count: 5, expanded: false, unread: 0 });
    expect(row({ threads, prefs: { expandedChildren: ["p"], expandedOlder: ["p"] } }, "a").chip).toEqual({ count: 2, expanded: false, unread: 0 });
  });

  it("opens onto its direct children only, whose rows and N more child threads add up to its number", () => {
    const open = { threads, prefs: { expandedChildren: ["p"] } };
    const rows = rowsOf(open);
    const children = rows.filter((candidate): candidate is ThreadRow => candidate.type === "thread" && candidate.depth === 1);
    const more = rows.find((candidate): candidate is OlderRow => candidate.type === "older" && candidate.scopeId === "p");
    expect(rows.some((candidate) => candidate.type === "thread" && candidate.depth > 1)).toBe(false);
    expect(children.length + (more?.count ?? 0)).toBe(row(open, "p").chip!.count);
    // With more quiet children than an open tree keeps, the rest go to N more child threads.
    const many = [parent, ...Array.from({ length: 9 }, (_, n) => child(`k${"x".repeat(n)}`))];
    const manyOpen = { threads: many, prefs: { expandedChildren: ["p"] } };
    const manyRows = rowsOf(manyOpen);
    const shown = manyRows.filter((candidate) => candidate.type === "thread" && candidate.depth === 1).length;
    const fold = manyRows.find((candidate): candidate is OlderRow => candidate.type === "older")!;
    expect(fold.count).toBeGreaterThan(0);
    expect(shown + fold.count).toBe(row(manyOpen, "p").chip!.count);
  });

  it("counts an archived child while archived threads are shown, which is when bb sends it", () => {
    const archived = [parent, child("c"), child("z", { isArchived: true, archivedAt: T0 })];
    expect(row({ threads: archived, prefs: { showArchived: true } }, "p").chip?.count).toBe(2);
    expect(row({ threads: archived.slice(0, 2) }, "p").chip?.count).toBe(1);
  });

  it("carries no state, tint or harness of its children beyond how many are unread", () => {
    const chip = row({ threads: [parent, child("c", { hasPendingInteraction: true, providerId: "codex" })] }, "p").chip!;
    expect(chip).toEqual({ count: 1, expanded: false, unread: 0 });
  });

  it("counts unread descendants at any depth, archived and hidden ones left out, whether open or closed", () => {
    const threads = [
      parent,
      child("c", finishedUnread),
      child("g", finishedUnread, "c"),
      child("z", { ...finishedUnread, isArchived: true, archivedAt: T0 }),
      child("h", { ...finishedUnread, isHidden: true }),
    ];
    expect(row({ threads, prefs: { showArchived: true } }, "p").chip).toMatchObject({ count: 2, unread: 2 });
    expect(row({ threads, prefs: { showArchived: true, expandedChildren: ["p"] } }, "p").chip).toMatchObject({ expanded: true, unread: 2 });
    expect(row({ threads: [parent, child("c"), child("h", { ...finishedUnread, isHidden: true })] }, "p").chip?.unread).toBe(0);
  });
});
