import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/shared/settings";
import { parkedRow, settledRow, snoozedRow } from "@/shared/lifecycle";
import { DAY, makeThread, PROJECTS, working } from "@/testing/fixtures";
import { INITIAL_DEVICE_STATE } from "../storage/device-state";
import { buildModel, type ModelInputs } from "./list-model";
import { NO_MARKS, parentsToClose as closing, settleMarksOf } from "./settle-close";
import type { ListModel } from "./list-model";

const NOW = Date.now();
const old = { createdAt: NOW - 4 * DAY, updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY };
const threads = [
  makeThread({ id: "p", ...old }),
  makeThread({ id: "c", parentThreadId: "p", ...old }),
  makeThread({ id: "g", parentThreadId: "c", ...old }),
  makeThread({ id: "other", ...old }),
];

function model(lifecycle: ModelInputs["lifecycle"], all = threads, scope: string[] = []) {
  return buildModel({
    threads: all,
    projects: PROJECTS,
    lifecycle,
    settings: { ...DEFAULT_SETTINGS, inactiveShelf: false },
    order: [],
    device: INITIAL_DEVICE_STATE,
    scope,
    activeThreadId: null,
    draftIds: new Set(),
    rowStatuses: new Map(),
    openElsewhereIds: new Set(),
    seenQuestionIds: new Set(),
    now: NOW,
    compact: false,
    settledShown: 10,
    frozenShelves: new Map(),
    pinnedOverride: null,
    drag: null,
  });
}

const marksOf = (m: ListModel) => settleMarksOf(m, NO_MARKS, new Map());
/** What the store passes: the marks as of the previous model, then the next. */
const parentsToClose = (previous: ListModel | null, next: ListModel, open: string[], marks = previous === null ? NO_MARKS : marksOf(previous)) =>
  closing(previous, next, open, marks);
const busyP = (all = threads) => all.map((thread) => (thread.id === "p" ? { ...thread, ...working } : thread));

describe("parentsToClose", () => {
  const before = model({});
  const after = model({ p: settledRow(NOW, "manual") });

  it("closes the open parents of a tree that moved onto Settled, however deep", () => {
    expect(parentsToClose(before, after, ["other", "c", "p"]).sort()).toEqual(["c", "p"]);
  });

  it("closes nothing for a tree that was already Settled, or on the first model", () => {
    expect(parentsToClose(after, after, ["p", "c"])).toEqual([]);
    expect(parentsToClose(null, after, ["p", "c"])).toEqual([]);
  });

  it("closes nothing for a tree that moved to another shelf, or that did not move, or when nothing is open", () => {
    expect(parentsToClose(before, model({ p: parkedRow(NOW) }), ["p"])).toEqual([]);
    expect(parentsToClose(before, model({ p: snoozedRow(NOW + DAY, NOW) }), ["p"])).toEqual([]);
    expect(parentsToClose(before, model({}), ["p"])).toEqual([]);
    expect(parentsToClose(before, after, [])).toEqual([]);
  });

  it("closes nothing for a settled tree that went busy and came back, or was unpinned, with the same settle mark", () => {
    const mark = { p: settledRow(NOW - DAY, "manual") };
    const away = model(mark, busyP());
    expect(away.rows.get("p")?.shelf).toBe("active");
    expect(parentsToClose(away, model(mark), ["p", "c"])).toEqual([]);
    const pinned = threads.map((thread) => (thread.id === "p" ? { ...thread, isPinned: true, pinnedAt: NOW } : thread));
    expect(parentsToClose(model(mark, pinned), model(mark), ["p"])).toEqual([]);
  });

  it("closes a tree settled again with a new settle mark", () => {
    expect(parentsToClose(model({ p: settledRow(NOW - DAY, "manual") }, busyP()), model({ p: settledRow(NOW, "manual") }), ["p"])).toEqual(["p"]);
  });

  it("closes nothing for a root that came into scope with the project scope, whatever its mark did meanwhile", () => {
    const elsewhere = PROJECTS.find((project) => project.id !== threads[0]!.projectId)!.id;
    const scoped = model({ p: settledRow(NOW - 2 * DAY, "manual") }, threads, [elsewhere]);
    expect(scoped.rows.get("p")?.shelf).toBeNull();
    expect(parentsToClose(scoped, model({ p: settledRow(NOW - DAY, "manual") }), ["p", "c"])).toEqual([]);
  });

  it("closes nothing for a root that was already Settled, though its mark changed", () => {
    expect(parentsToClose(model({ p: settledRow(NOW - DAY, "auto") }), model({ p: settledRow(NOW, "manual") }), ["p"])).toEqual([]);
  });
});

describe("settleMarksOf", () => {
  it("keeps the mark a held root had before its hold, and takes the others' from the model", () => {
    const mark = { p: settledRow(NOW - DAY, "manual") };
    const settledNow = model(mark);
    const held = new Map([["p", "active" as const]]);
    expect(settleMarksOf(settledNow, new Map([["p", null]]), held).get("p")).toBeNull();
    expect(settleMarksOf(settledNow, new Map([["p", null]]), new Map()).get("p")).toBe(NOW - DAY);
    expect(settleMarksOf(settledNow, NO_MARKS, held).get("p")).toBeNull();
  });

  it("lets a rename that holds a settled root across the end of its turn close nothing, and one across a settle close the tree", () => {
    const mark = { p: settledRow(NOW - DAY, "manual") };
    const held = new Map([["p", "working" as const]]);
    const beforeHold = marksOf(model(mark));
    const duringHold = settleMarksOf(model(mark, busyP()), beforeHold, held);
    expect(closing(model(mark, busyP()), model(mark), ["p"], duringHold)).toEqual([]);
    const unsettled = marksOf(model({}));
    const settledMeanwhile = settleMarksOf(model(mark), unsettled, new Map([["p", "active" as const]]));
    expect(closing(model({}), model(mark), ["p"], settledMeanwhile)).toEqual(["p"]);
  });
});
