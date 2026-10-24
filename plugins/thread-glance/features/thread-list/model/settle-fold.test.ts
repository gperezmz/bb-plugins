import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/shared/settings";
import { settledRow } from "@/shared/lifecycle";
import { DAY, makeThread, PROJECTS } from "@/testing/fixtures";
import { INITIAL_DEVICE_STATE } from "../storage/device-state";
import { buildModel, type ModelInputs } from "./list-model";
import { parentsToFold } from "./settle-fold";

const NOW = Date.now();
const old = { createdAt: NOW - 4 * DAY, updatedAt: NOW - 3 * DAY, latestAttentionAt: NOW - 3 * DAY };
const threads = [
  makeThread({ id: "p", ...old }),
  makeThread({ id: "c", parentThreadId: "p", ...old }),
  makeThread({ id: "g", parentThreadId: "c", ...old }),
  makeThread({ id: "other", ...old }),
];

function model(lifecycle: ModelInputs["lifecycle"]) {
  return buildModel({
    threads,
    projects: PROJECTS,
    lifecycle,
    settings: { ...DEFAULT_SETTINGS, inactiveShelf: false },
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
  });
}

describe("parentsToFold", () => {
  const before = model({});
  const after = model({ p: settledRow(NOW, "manual") });

  it("folds the expanded parents of a tree that moved onto Settled, however deep", () => {
    expect(parentsToFold(before, after, ["other", "c", "p"]).sort()).toEqual(["c", "p"]);
  });

  it("folds nothing for a tree that was already Settled, or on the first model", () => {
    expect(parentsToFold(after, after, ["p", "c"])).toEqual([]);
    expect(parentsToFold(null, after, ["p", "c"])).toEqual([]);
  });

  it("folds nothing for a tree that moved to another shelf, or when nothing is expanded", () => {
    expect(parentsToFold(before, model({}), ["p"])).toEqual([]);
    expect(parentsToFold(before, after, [])).toEqual([]);
  });
});
