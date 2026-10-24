import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/shared/settings";
import { parkedRow, settledRow, snoozedRow } from "@/shared/lifecycle";
import { DAY, makeThread, PROJECTS, working } from "@/testing/fixtures";
import { INITIAL_DEVICE_STATE } from "../storage/device-state";
import { buildModel, type ModelInputs } from "./list-model";
import { parentsToClose } from "./settle-close";

const NOW = Date.now();
const old = { createdAt: NOW - 4 * DAY, updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY };
const threads = [
  makeThread({ id: "p", ...old }),
  makeThread({ id: "c", parentThreadId: "p", ...old }),
  makeThread({ id: "g", parentThreadId: "c", ...old }),
  makeThread({ id: "other", ...old }),
];

function model(lifecycle: ModelInputs["lifecycle"], all = threads, scopeId: string | null = null) {
  return buildModel({
    threads: all,
    projects: PROJECTS,
    lifecycle,
    settings: { ...DEFAULT_SETTINGS, inactiveShelf: false },
    order: [],
    device: INITIAL_DEVICE_STATE,
    scopeId,
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
}

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
    const busy = threads.map((thread) => (thread.id === "p" ? { ...thread, ...working } : thread));
    const away = model(mark, busy);
    expect(away.rows.get("p")?.shelf).toBe("active");
    expect(parentsToClose(away, model(mark), ["p", "c"])).toEqual([]);
    const pinned = threads.map((thread) => (thread.id === "p" ? { ...thread, isPinned: true, pinnedAt: NOW } : thread));
    expect(parentsToClose(model(mark, pinned), model(mark), ["p"])).toEqual([]);
  });

  it("closes a tree settled again with a new settle mark", () => {
    const busy = threads.map((thread) => (thread.id === "p" ? { ...thread, ...working } : thread));
    expect(parentsToClose(model({ p: settledRow(NOW - DAY, "manual") }, busy), model({ p: settledRow(NOW, "manual") }), ["p"])).toEqual(["p"]);
  });

  it("closes nothing for a root that came into scope with the project scope, whatever its mark did meanwhile", () => {
    const elsewhere = PROJECTS.find((project) => project.id !== threads[0]!.projectId)!.id;
    const scoped = model({ p: settledRow(NOW - 2 * DAY, "manual") }, threads, elsewhere);
    expect(scoped.rows.get("p")?.shelf).toBeNull();
    expect(parentsToClose(scoped, model({ p: settledRow(NOW - DAY, "manual") }), ["p", "c"])).toEqual([]);
  });

  it("closes nothing for a root that was already Settled, though its mark changed", () => {
    expect(parentsToClose(model({ p: settledRow(NOW - DAY, "auto") }), model({ p: settledRow(NOW, "manual") }), ["p"])).toEqual([]);
  });

  it("closes a root whose shelf was held, as a rename holds it, though its settle mark was already there", () => {
    const mark = { p: settledRow(NOW - DAY, "manual") };
    const held = model(mark, threads.map((thread) => (thread.id === "p" ? { ...thread, ...working } : thread)));
    expect(parentsToClose(held, model(mark), ["p"])).toEqual([]);
    expect(parentsToClose(held, model(mark), ["p"], new Map([["p", "active"]]))).toEqual(["p"]);
  });
});
