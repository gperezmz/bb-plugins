import { describe, expect, it } from "vitest";
import { attentionRootIds, failedUnread, finishedUnread, makeThread, T0, viewOf, working, type Scenario } from "../testing/fixtures";
import type { OlderRow, ThreadRow } from "./view";

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
  it("shows the parent's own state: an idle parent with working children is idle, not a spinner", () => {
    const scenario = { threads: [parent, child("c", working)] };
    expect(row(scenario, "p").info.state.kind).toBe("idle");
    expect(row(scenario, "p").info.state.glyph.spin).toBe(false);
    const busy = { threads: [{ ...parent, ...working }, child("c")] };
    expect(row(busy, "p").info.state.kind).toBe("working");
  });
});

describe("the child dot", () => {
  const dot = (...children: ReturnType<typeof makeThread>[]) => row({ threads: [parent, ...children] }, "p").chip?.state ?? null;

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
    expect(row({ threads: [parent] }, "p").chip?.state ?? null).toBeNull();
  });

  it("reads descendants at any depth", () => {
    expect(dot(child("c"), child("g", { hasPendingInteraction: true }, "c"))).toBe("waits-on-you");
    expect(row({ threads: [parent, child("c"), child("g", working, "c")], prefs: { expandedChildren: ["p"] } }, "c").chip?.state ?? null).toBe("working");
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
    expect(row({ threads }, "p").chip).toEqual({ count: 5, expanded: false, state: null });
    expect(row({ threads, prefs: { expandedChildren: ["p"], expandedOlder: ["p"] } }, "a").chip).toEqual({ count: 2, expanded: false, state: null });
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

  it("carries its children's most urgent state, and no tint or harness of theirs", () => {
    const chip = row({ threads: [parent, child("c", { hasPendingInteraction: true, providerId: "codex" })] }, "p").chip!;
    expect(chip).toEqual({ count: 1, expanded: false, state: "waits-on-you" });
  });
});
