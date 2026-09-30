// The derive step's rules, each applied in the step that sees its change,
// not one step later.
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
import { makeThread, PROJECTS, T0 } from "../testing/fixtures";
import { derive, FIRST_STEP, NO_HOST, type DeriveMemory, type ListInputs } from "./derive";

const HOUR = 3_600_000;

function inputsOf(threads: PluginSidebarThread[], patch: Partial<ListInputs> = {}, prefs: Partial<Preferences> = {}): ListInputs {
  return {
    host: { ...NO_HOST, status: "ready", threads, projects: PROJECTS },
    activeThreadId: null,
    stamps: { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {}, idleAt: {} },
    stampsLoaded: true,
    notes: {},
    scheduled: {},
    prefs: { ...defaultPreferences(), settleAfter: "never", ...prefs },
    hydrated: true,
    client: { density: "compact", branchLine: false },
    system: { defaultProviderId: "claude-code", primaryHostId: "host_1" },
    defaultBranches: new Map(),
    now: T0 + 60_000,
    idleSince: {},
    needYouOn: false,
    targets: new Map(),
    ...patch,
  };
}

/** Runs one step after another, each over the last one's inputs with `patch` applied. */
function steps(first: ListInputs) {
  let memory: DeriveMemory = FIRST_STEP;
  let inputs = first;
  return (patch: Partial<ListInputs> = {}) => {
    const step = derive({ ...inputs, ...patch }, memory, inputs.now);
    memory = step.memory;
    inputs = step.inputs;
    return step;
  };
}

const rowIdsOf = (step: ReturnType<ReturnType<typeof steps>>, groupId = "project:proj_a") =>
  step.model!.groupsById.get(groupId)!.rows.map((row) => (row.type === "thread" ? row.info.thread.id : row.key));

describe("the derive step", () => {
  it("holds a tree that settles while focused in the step where it settles", () => {
    const now = T0 + 12 * HOUR - 30_000;
    const step = steps(
      inputsOf(
        [
          makeThread({ id: "live", createdAt: now, latestAttentionAt: now, lastReadAt: now }),
          makeThread({ id: "f" }),
        ],
        { activeThreadId: "f", now },
        { settleAfter: "12h" },
      ),
    );
    expect(rowIdsOf(step())).toEqual(["live", "f"]);
    const settles = step({ now: now + 60_000 });
    expect(settles.memory.hold?.settled.has("f")).toBe(true);
    expect(rowIdsOf(settles)).toEqual(["live", "f"]);
    // Focus moving away ends the hold in the same step.
    expect(rowIdsOf(step({ activeThreadId: "live" }))).toEqual(["live", "settled:project:proj_a"]);
  });

  it("reveals a child that newly needs you in the step that sees it", () => {
    const parent = makeThread({ id: "p" });
    const child = makeThread({ id: "c", parentThreadId: "p" });
    const step = steps(inputsOf([parent, child]));
    expect(rowIdsOf(step())).toEqual(["p"]);
    const asks = step({
      host: { ...NO_HOST, status: "ready", projects: PROJECTS, threads: [parent, { ...child, hasPendingInteraction: true, status: "active" }] },
    });
    expect(asks.inputs.targets.get("c")).toBe("reveal");
    expect(rowIdsOf(asks)).toContain("c");
  });

  it("turns the need-you filter off in the step where nothing needs you any more", () => {
    const asking = makeThread({ id: "a", hasPendingInteraction: true, status: "active" });
    const step = steps(inputsOf([asking, makeThread({ id: "b" })], { needYouOn: true }));
    expect(step().inputs.needYouOn).toBe(true);
    const answered = step({ host: { ...NO_HOST, status: "ready", projects: PROJECTS, threads: [makeThread({ id: "a" }), makeThread({ id: "b" })] } });
    expect(answered.inputs.needYouOn).toBe(false);
    expect(rowIdsOf(answered)).toEqual(["a", "b"]);
  });

  it("marks child threads seen when the focus arrives and leaves, before building on the stamps", () => {
    const threads = [makeThread({ id: "p" }), makeThread({ id: "c", parentThreadId: "p" }), makeThread({ id: "d", parentThreadId: "p" })];
    const step = steps(inputsOf(threads));
    step();
    const arrive = step({ activeThreadId: "c" });
    expect(arrive.seen).toEqual(["c"]);
    expect(arrive.inputs.stamps.seenAt.c).toBe(T0 + 60_000);
    expect(step({ activeThreadId: "d" }).seen).toEqual(["c", "d"]);
    expect(step({ activeThreadId: "p" }).seen).toEqual(["d"]);
    expect(step({}).seen).toEqual([]);
  });

  it("keeps every row and group whose content is unchanged, and the time label on the row", () => {
    const now = T0 + 5 * 60_000;
    const twoDays = now - 48 * HOUR;
    const step = steps(
      inputsOf([makeThread({ id: "a", createdAt: twoDays, latestAttentionAt: twoDays }), makeThread({ id: "b", latestAttentionAt: now - 30_000 })], { now }),
    );
    const first = step();
    const b = (value: typeof first) => value.model!.groupsById.get("project:proj_a")!.rows.find((row) => row.key === "thread:b");
    const a = (value: typeof first) => value.model!.groupsById.get("project:proj_a")!.rows.find((row) => row.key === "thread:a");
    // A minute later a still reads "2d", while b goes from "now" to "1m".
    const later = step({ now: now + 60_000 });
    expect(a(later)).toBe(a(first));
    expect(b(later)).not.toBe(b(first));
    expect(b(later)).toMatchObject({ time: { text: "1m" } });
    expect(later.model!.groupIds).toBe(first.model!.groupIds);
  });
});
