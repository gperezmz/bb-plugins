// The budget ledger: its rows, and that a row fails its run when a figure
// misses its threshold, for one row of each kind of measurement.
import { describe, expect, it } from "vitest";
import { emptyFigures, type Figures } from "./figures";
import { evaluate, failures, LEDGER } from "./ledger";
import { missedBudgets } from "./harness/enforce";
import type { EventFigure, JsdomFigures } from "./harness/jsdom-run";
import type { HostFigures, Requests } from "./harness/host-run";
import type { ChromiumFigures } from "./harness/chromium-figures";

describe("the ledger", () => {
  it("holds exactly B2 to B29, each with its threshold, baseline and measurement", () => {
    expect(LEDGER.map((candidate) => candidate.id)).toEqual(Array.from({ length: 28 }, (_, index) => `B${index + 2}`));
    for (const candidate of LEDGER) {
      expect(candidate.threshold).not.toBe("");
      expect(candidate.baseline).not.toBe("");
      expect(candidate.measuredBy).not.toBe("");
    }
  });

  it("reads every row off a run that took nothing as not measured, failing none", () => {
    const verdicts = evaluate(emptyFigures());
    expect(verdicts.every((verdict) => verdict.reading.pass === null)).toBe(true);
    expect(failures(verdicts)).toEqual([]);
  });
});

const event = (overrides: Partial<EventFigure>): EventFigure => ({
  rows: 1,
  rowIds: ["t0"],
  distinctRows: 1,
  extraRows: 0,
  groupHeaders: 0,
  listHeader: 0,
  extraHeaders: 0,
  commits: 1,
  jsMs: 1,
  threadId: "t0",
  ...overrides,
});

function jsdomWith(events: Record<string, EventFigure>): JsdomFigures {
  return {
    threads: 1_500,
    mountedRows: 1_000,
    groups: 4,
    events,
    drag: { moves: 50, targetChanges: 25, maxRowsOnChange: 1, rowsOnUnchanged: 0, otherRows: 0, commits: 50, jsMs: 1 },
    dropFeedback: { changes: 25, maxRowsOnChange: 2, rowsOnUnchanged: 0 },
    minuteTick: { rendered: 3, expected: 3, extra: 0, missed: 0, hidden: 0 },
    menuPrimitives: {},
  };
}

const none: Requests = { rpc: {}, bb: {}, rpcTotal: 0, bbTotal: 0 };

/** One `sync`: what a first load, or a remount without bb's app overlay slot, asks. */
const oneSync: Requests = { rpc: { sync: 1 }, bb: {}, rpcTotal: 1, bbTotal: 0 };

function hostWith(idle: Requests): HostFigures {
  return {
    firstLoad: oneSync,
    remount: oneSync,
    remountWithOverlay: none,
    idle: { "1": idle, "2": none, "3": none },
    idleAtWritesPerTransition: 0,
    hooksPerRow: { useSidebarThreadShortcut: 1 },
  };
}

function chromiumWith(remountToFirstRowMs: number): ChromiumFigures {
  const inp = { x1: 10, x4: 20 };
  return {
    build: "production",
    inp: { group: inp, childrenChip: inp, settledFold: null },
    mountToFirstRowMs: remountToFirstRowMs,
    remountToFirstRowMs,
    scrollMountMs: 10,
    rowsMounted: 40,
    window: { checks: 1, excess: 0, missing: 0 },
    cycles: { heapGrowthBytes: 0, intersectionObservers: [1, 1], resizeObservers: [1, 1], detachedNodes: [0, 0] },
    eventJsMs: { "turn starts on screen": 1 },
    phone: { rowsMountedClosed: 10, rowHeightPx: 28, openFrameMaxMs: 16, openFrameP95Ms: 16 },
  };
}

function withFigures(patch: Partial<Figures>): Figures {
  return { ...emptyFigures(), ...patch };
}

const SYNC_PAYLOAD = {
  threads: 10,
  archived: 1,
  firstRecords: 9,
  firstArchivedRecords: 0,
  firstBytes: 900,
  unchangedRecords: 0,
  unchangedBytes: 200,
};

/**
 * One row per kind of measurement, each read once at its threshold and once
 * over it: bundle check, jsdom, Chromium, fake host, and the
 * plugin server (`server.test`'s rows).
 */
const CASES: { kind: string; id: string; within: Figures; over: Figures }[] = [
  {
    kind: "bundle check",
    id: "B2",
    within: withFigures({ bundle: { rawBytes: 250_000, gzipBytes: 80_000, brotliBytes: 70_000 } }),
    over: withFigures({ bundle: { rawBytes: 250_000, gzipBytes: 80_001, brotliBytes: 70_000 } }),
  },
  {
    kind: "jsdom",
    id: "B3",
    within: withFigures({ jsdom: { "1500/live": jsdomWith({ "update on screen": event({}) }) } }),
    over: withFigures({
      jsdom: { "1500/live": jsdomWith({ "update on screen": event({ rows: 2, rowIds: ["t0", "t1"], distinctRows: 2, extraRows: 1 }) }) },
    }),
  },
  {
    kind: "Chromium",
    id: "B12",
    within: withFigures({ chromium: { "1500/live": chromiumWith(299) } }),
    over: withFigures({ chromium: { "1500/live": chromiumWith(300) } }),
  },
  {
    kind: "fake host",
    id: "B22",
    within: withFigures({ host: { "300/live": hostWith(none) } }),
    over: withFigures({ host: { "300/live": hostWith({ rpc: { sync: 1 }, bb: {}, rpcTotal: 1, bbTotal: 0 }) } }),
  },
  {
    kind: "server",
    id: "B23",
    within: withFigures({
      server: {
        signalsPerEvent: { "thread.active": 1, "thread.idle": 1 },
        syncPayload: SYNC_PAYLOAD,
        firstRead: { handlerMs: 1, callMs: 2, threads: 5_000 },
      },
    }),
    over: withFigures({
      server: {
        signalsPerEvent: { "thread.active": 1, "thread.idle": 2 },
        syncPayload: SYNC_PAYLOAD,
        firstRead: { handlerMs: 1, callMs: 2, threads: 5_000 },
      },
    }),
  },
];

describe("a row", () => {
  it.each(CASES)("fails its run when its $kind figure ($id) is over budget, and passes at it", ({ id, within, over }) => {
    const failed = (figures: Figures) =>
      evaluate(figures).filter((verdict) => verdict.failed).map((verdict) => verdict.row.id);
    expect(failed(within)).toEqual([]);
    expect(failed(over)).toEqual([id]);
  });

  it("fails the run that takes its kind, and only that run", () => {
    const over = withFigures({ host: { "300/live": hostWith({ rpc: {}, bb: { "projects.get": 1 }, rpcTotal: 0, bbTotal: 1 }) } });
    expect(missedBudgets(over, ["deterministic", "both"])).toHaveLength(1);
    expect(missedBudgets(over, ["timing"])).toEqual([]);
  });
});
