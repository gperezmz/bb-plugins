// The budget ledger of the Thread Glance list rewrite (#145–#154): every
// budget of the rewrite, one row each. Nothing else holds a budget; a slice
// names the ids it switches on.
//
// A row is enforcing while its `enforcing` field is true: the run that
// measures it then fails when the row's threshold is missed. The slice named
// in "Switched on by" sets it to true in the same change that makes the row
// hold; the column itself only documents who does. Rows of #145 and of #146,
// which merged before the ledger existed, start true, except B1, which B2
// retired. Rows of kind "deterministic" (render counts, rows
// mounted, requests, signals, writes, bundle size) run in `npm test`, and so
// in CI. Rows of kind "timing" (INP, milliseconds, heap) run in `npm run
// perf`, outside CI: each slice records their output in its pull request, and
// a figure over its threshold blocks the merge as a failing check would. A
// row of kind "both" has a part of each, taken by the run of each.
//
// Terms the rows use:
// - harness: this ledger's synthetic run, over lists generated from a seed
//   (`generateList` in features/thread-list/testing/fixtures.ts);
// - jsdom: its render counts, taken on React's development build, which
//   counts renders as the production build does;
// - Chromium: its browser run (vitest browser mode, Playwright), which times
//   React's production build, the build bb ships;
// - fake host: its fake bb and plugin server, which count requests;
// - MAR list: the Mark all read list, 1,500 threads with 443 unread;
// - real drive: a drive of real bb threads with the driving-bb-plugins
//   skill (a slice's short drive of about 50, or #154's release drive of
//   about 800).
// "Measured by" is the synthetic harness at the sizes it names, 1,500
// included; any figure a real drive takes for a row is measured at that
// drive's size, not at 1,500.
//
// Settled for every slice, so no slice re-decides them:
// - In jsdom, which lays nothing out, a thread "off screen" is a child thread
//   behind its closed children chip, which has no row mounted. In Chromium it
//   is a thread scrolled out of view.
// - The Settled fold exists only where something is settled, so its INP is
//   taken in the settled scenario; the live scenario reports n/a.
// - A row "renders" when the outermost component around its anchor
//   (`data-sidebar-thread-id`) runs; group headers and the list header
//   likewise by `data-sidebar="group-label"` and `data-sidebar="list-header"`
//   (perf/harness/render-counter.ts).
// - A figure the harness cannot reproduce on the code it runs against is
//   reported as measured, never tuned until it shows. Where that figure is
//   one of the defects #145's acceptance criteria expect on 0.7.0, that part
//   of the criterion stands as not met in #145's pull request.
import type { Cell, Figures } from "./figures";
import { CELLS } from "./figures";
import type { InpFigure } from "./harness/chromium-figures";
import type { EventFigure } from "./harness/jsdom-run";

export type Kind = "deterministic" | "timing" | "both";

/** A row's figure from one run: what it read, and whether that meets the threshold (null: not measured here). */
export interface Reading {
  figure: string;
  pass: boolean | null;
}

export interface LedgerRow {
  id: string;
  bounds: string;
  threshold: string;
  baseline: string;
  measuredBy: string;
  kind: Kind;
  /** The slice that switches the row on, by setting `enforcing`. */
  switchedOnBy: number;
  /** Whether a missed threshold fails the run. */
  enforcing: boolean;
  /** The row that took this one's place, when it was retired. */
  retiredBy?: string;
  read(figures: Figures): Reading;
}

const KB = 1_000;
const NOT_MEASURED: Reading = { figure: "not measured in this run", pass: null };

/** Reads a figure off every generated list that has it, passing only if each does. */
function acrossCells<T>(
  cells: readonly Cell[],
  source: (cell: Cell) => T | undefined,
  read: (value: T, cell: Cell) => Reading,
): Reading {
  const readings = cells.flatMap((cell) => {
    const value = source(cell);
    return value === undefined ? [] : [{ cell, reading: read(value, cell) }];
  });
  if (readings.length === 0) return NOT_MEASURED;
  const failing = readings.filter(({ reading }) => reading.pass === false);
  const shown = failing.length > 0 ? failing : readings;
  const passes = readings.map(({ reading }) => reading.pass);
  return {
    figure: shown.map(({ cell, reading }) => `${cell}: ${reading.figure}`).join("; "),
    pass: passes.includes(false) ? false : passes.every((pass) => pass === true) ? true : null,
  };
}

const AT_1500: Cell[] = ["1500/live", "1500/settled"];

function events(names: readonly string[], rule: (event: EventFigure, name: string) => Reading) {
  return (figures: Figures, cells: readonly Cell[] = CELLS) =>
    acrossCells(
      cells,
      (cell) => figures.jsdom[cell],
      (jsdom) => {
        const readings = names.flatMap((name) => {
          const event = jsdom.events[name];
          return event === undefined ? [] : [{ name, reading: rule(event, name) }];
        });
        const failing = readings.filter(({ reading }) => reading.pass === false);
        return {
          figure: (failing.length > 0 ? failing : readings).map(({ name, reading }) => `${name} ${reading.figure}`).join(", "),
          pass: failing.length === 0,
        };
      },
    );
}

/** Rows and headers an event rendered beyond its own row and what changed. */
function onlyItsOwn(event: EventFigure): Reading {
  const others = event.rowIds === null ? event.distinctRows : event.rowIds.filter((id) => id !== event.threadId).length;
  return {
    figure: `${event.distinctRows} rows (${event.extraRows} unchanged), ${event.extraHeaders} unchanged headers`,
    pass: others === 0 && event.extraHeaders === 0,
  };
}

function changedOnly(event: EventFigure): Reading {
  return {
    figure: `${event.distinctRows} rows (${event.extraRows} unchanged), ${event.extraHeaders} unchanged headers`,
    pass: event.extraRows === 0 && event.extraHeaders === 0,
  };
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `${Math.round(value)} ms`;
}

/** An INP; Event Timing reports nothing under 16 ms, which the run records as 0. */
function inpMs(value: number | null): string {
  return value === 0 ? "< 16 ms" : ms(value);
}

function inpReading(inp: InpFigure | null): Reading {
  if (inp === null) return { figure: "n/a", pass: null };
  const pass = inp.x1 !== null && inp.x4 !== null ? inp.x1 < 100 && inp.x4 < 200 : null;
  return { figure: `${inpMs(inp.x1)} at 1×, ${inpMs(inp.x4)} at 4×`, pass };
}

/** `app.js` against a raw and a gzip ceiling, in KB. */
function bundleReading({ bundle }: Figures, rawKb: number, gzipKb: number): Reading {
  if (bundle === undefined) return NOT_MEASURED;
  return {
    figure: `${(bundle.rawBytes / KB).toFixed(1)} KB raw, ${(bundle.gzipBytes / KB).toFixed(1)} KB gzip`,
    pass: bundle.rawBytes <= rawKb * KB && bundle.gzipBytes <= gzipKb * KB,
  };
}

export const LEDGER: readonly LedgerRow[] = [
  {
    id: "B1",
    bounds: "`app.js` size before #146",
    threshold: "≤ 560 KB raw and ≤ 165 KB gzip",
    baseline: "511 KB / 149 KB",
    measuredBy: "bundle check (`bb plugin build`, KB = 1,000 bytes), in `npm test`",
    kind: "deterministic",
    switchedOnBy: 145,
    enforcing: false,
    retiredBy: "B2",
    read: (figures) => bundleReading(figures, 560, 165),
  },
  {
    id: "B2",
    bounds: "`app.js` size",
    threshold: "≤ 250 KB raw and ≤ 80 KB gzip",
    baseline: "511 KB / 149 KB",
    measuredBy: "bundle check (`bb plugin build`, KB = 1,000 bytes), in `npm test`",
    kind: "deterministic",
    switchedOnBy: 146,
    enforcing: true,
    read: (figures) => bundleReading(figures, 250, 80),
  },
  {
    id: "B3",
    bounds:
      "Renders for one thread's update from bb that leaves its place in the list unchanged, one stamp or note signal, or one read or unread change",
    threshold: "that thread's row only; its group header and the list header only when a count or flag they show changed",
    baseline: "every mounted row",
    measuredBy:
      "jsdom, 50/300/1,500, live and settled: events `update on screen`, `update off screen`, `stamp signal`, `note signal`, `read change`",
    kind: "deterministic",
    switchedOnBy: 148,
    enforcing: false,
    // A thread off screen has no row to render; its parent's children chip may change.
    read: (figures) =>
      events(["update on screen", "update off screen", "stamp signal", "note signal", "read change"], (event, name) =>
        name === "update off screen" ? changedOnly(event) : onlyItsOwn(event),
      )(figures),
  },
  {
    id: "B4",
    bounds: "The plugin's JavaScript per realtime event (a turn starting or finishing on one thread, on screen or off)",
    threshold: "< 16 ms",
    baseline: "110–134 ms",
    measuredBy: "Chromium, 1,500, live and settled (production React; script time through the DevTools protocol)",
    kind: "timing",
    switchedOnBy: 148,
    enforcing: false,
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], (figure) => {
        const worst = Math.max(...Object.values(figure.eventJsMs));
        return { figure: `worst ${ms(worst)}`, pass: worst < 16 };
      }),
  },
  {
    id: "B5",
    bounds: "Renders on the minute tick",
    threshold: "exactly the rows whose Trailing slot text or label changed; none while the window is hidden",
    baseline: "every mounted row",
    measuredBy:
      "jsdom with fake timers, 1,500, against labels computed from the generated threads (a list mounted fresh at the later clock)",
    kind: "deterministic",
    switchedOnBy: 148,
    enforcing: false,
    read: ({ jsdom }) =>
      acrossCells(AT_1500, (cell) => jsdom[cell], ({ minuteTick: tick }) => ({
        figure: `${tick.rendered} rendered for ${tick.expected} changed (${tick.extra} extra, ${tick.missed} missed), ${tick.hidden} while hidden`,
        pass: tick.extra === 0 && tick.missed === 0 && tick.hidden === 0,
      })),
  },
  {
    id: "B6",
    bounds:
      "Renders when the host hands over a new `actions` object, a new `onNavigate`, or equal-content `providers`, `sections` or environment providers with new identities",
    threshold: "no row",
    baseline: "every mounted row",
    measuredBy: "jsdom with the fake host: events `new actions`, `new onNavigate`, `equal providers`",
    kind: "deterministic",
    switchedOnBy: 148,
    enforcing: false,
    read: (figures) =>
      events(["new actions", "new onNavigate", "equal providers"], (event) => ({
        figure: `${event.distinctRows} rows`,
        pass: event.distinctRows === 0,
      }))(figures),
  },
  {
    id: "B7",
    bounds: "Renders on a split layout change (focus moving between panes, a split opening or closing)",
    threshold: "only rows whose split mini-map appears, disappears or changes",
    baseline: "every mounted row",
    measuredBy: "jsdom: event `split layout`",
    kind: "deterministic",
    switchedOnBy: 151,
    enforcing: false,
    read: (figures) => events(["split layout"], changedOnly)(figures),
  },
  {
    id: "B8",
    bounds: "Renders caused by the list's drop feedback",
    threshold: "≤ 2 rows per change of target, none when the target is unchanged",
    baseline: "every mounted row per move",
    measuredBy:
      "jsdom: 50 changes of the store's drop feedback with dnd-kit's state held constant. Until #148 builds that store, the figure is read off 50 drag moves over rows (the `drag` figures)",
    kind: "deterministic",
    switchedOnBy: 148,
    enforcing: false,
    read: ({ jsdom }) =>
      acrossCells(CELLS, (cell) => jsdom[cell], ({ drag }) => ({
        figure: `up to ${drag.maxRowsOnChange} rows per change of target, ${drag.rowsOnUnchanged} on unchanged moves`,
        pass: drag.maxRowsOnChange <= 2 && drag.rowsOnUnchanged === 0,
      })),
  },
  {
    id: "B9",
    bounds: "All renders over 50 drag moves",
    threshold:
      "no thread row apart from the dragged row, once when the drag starts and once when it ends; feedback drawn only where the target changes. Under #152's fallback (a draggable per mounted row): no thread row renders on a move that leaves the target unchanged, and at most the mounted rows once per change of target",
    baseline: "every mounted row per move",
    measuredBy: "jsdom: 50 drag moves over rows (the `drag` figures)",
    kind: "deterministic",
    switchedOnBy: 152,
    enforcing: false,
    read: ({ jsdom }) =>
      acrossCells(CELLS, (cell) => jsdom[cell], ({ drag, mountedRows }) => ({
        figure: `${drag.otherRows} renders of other rows over ${drag.moves} moves (${drag.rowsOnUnchanged} on unchanged moves, up to ${drag.maxRowsOnChange} per change)`,
        pass: drag.otherRows === 0 || (drag.rowsOnUnchanged === 0 && drag.maxRowsOnChange <= mountedRows),
      })),
  },
  {
    id: "B10",
    bounds:
      'Rows mounted, however scrolled and after any group, children chip, "N more child threads", environment or Settled fold opens or closes',
    threshold:
      "exactly the rows intersecting the view extended 240 px above and below, plus the rows that must stay mounted (#150), plus each group's header",
    baseline: "most rows",
    measuredBy: "Chromium, 1,500, mounted anchors against computed positions",
    kind: "deterministic",
    switchedOnBy: 150,
    enforcing: false,
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], ({ window }) => ({
        figure: `${window.excess} rows mounted outside, ${window.missing} missing inside, over ${window.checks} checks`,
        pass: window.excess === 0 && window.missing === 0,
      })),
  },
  {
    id: "B11",
    bounds: "INP for opening a group, a children chip and the Settled fold",
    threshold: "< 100 ms at 1× CPU, < 200 ms at 4×",
    baseline: "416 / 384 / 376 ms; 1.7 s at 4×",
    measuredBy:
      "Chromium Event Timing, 1,500 (production React). The Settled fold's is taken in the settled scenario only; live reports n/a",
    kind: "timing",
    switchedOnBy: 150,
    enforcing: false,
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], ({ inp }) => {
        const readings = [
          ["group", inpReading(inp.group)],
          ["children chip", inpReading(inp.childrenChip)],
          ["Settled fold", inpReading(inp.settledFold)],
        ] as const;
        const passes = readings.map(([, reading]) => reading.pass).filter((pass) => pass !== null);
        return {
          figure: readings.map(([name, reading]) => `${name} ${reading.figure}`).join(", "),
          pass: passes.length === 0 ? null : passes.every(Boolean),
        };
      }),
  },
  {
    id: "B12",
    bounds: "Remount to first row drawn",
    threshold: "< 300 ms",
    baseline: "2.2 s",
    measuredBy: "Chromium, 1,500 (production React)",
    kind: "timing",
    switchedOnBy: 150,
    enforcing: false,
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], (figure) => ({
        figure: ms(figure.remountToFirstRowMs),
        pass: figure.remountToFirstRowMs < 300,
      })),
  },
  {
    id: "B13",
    bounds: "Growth across 10 unmount and mount cycles, after forced GC",
    threshold:
      "JS heap < 0.5 MB in total; IntersectionObserver and ResizeObserver counts back to first-mount values; plugin-held detached nodes not growing",
    baseline: "+1.3 MB, +8 observers, +5.5k nodes per cycle",
    measuredBy:
      "Chromium through the DevTools protocol, 1,500 (HeapProfiler.collectGarbage, Runtime.queryObjects, DOM.getDetachedDomNodes). The slice that switches it on also confirms it with its short real drive",
    kind: "timing",
    switchedOnBy: 150,
    enforcing: false,
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], ({ cycles }) => {
        const grew = (series: number[]) => series.length > 1 && series.at(-1)! > series[0]!;
        return {
          figure: `heap +${(cycles.heapGrowthBytes / 1_000_000).toFixed(2)} MB, IntersectionObserver ${cycles.intersectionObservers.join("→")}, ResizeObserver ${cycles.resizeObservers.join("→")}, detached nodes ${cycles.detachedNodes.join("→")}`,
          pass:
            cycles.heapGrowthBytes < 500_000 &&
            !grew(cycles.intersectionObservers) &&
            !grew(cycles.resizeObservers) &&
            !grew(cycles.detachedNodes),
        };
      }),
  },
  {
    id: "B14",
    bounds: "Renders for a new thread, or a thread moving up or down",
    threshold:
      "its own row plus rows whose drawn content changed; a row whose only change is its position does not render; its group header and the list header only when a count or flag they show changed",
    baseline: "255 rows remounted",
    measuredBy: "jsdom, 1,500: events `new thread`, `thread moves`",
    kind: "deterministic",
    switchedOnBy: 150,
    enforcing: false,
    read: (figures) => events(["new thread", "thread moves"], changedOnly)(figures, AT_1500),
  },
  {
    id: "B15",
    bounds: "Phone viewport (390×844): rows mounted with the drawer closed, and scrolling frames with it open",
    threshold: "closed: no more rows than fit in 480 px, plus rows that must stay mounted; open: every scroll frame < 17 ms",
    baseline: "all rows rendered while hidden",
    measuredBy:
      "Chromium at 390×844, 1,500. Closed: the list in a 390×844 drawer moved off-canvas with `translateX(-100%)`. Open: the drawer on screen, scrolled. The closed count is deterministic, the frames timing",
    kind: "both",
    switchedOnBy: 150,
    enforcing: false,
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], ({ phone }) => {
        const fit = Math.ceil(480 / Math.max(phone.rowHeightPx, 1));
        return {
          figure: `closed ${phone.rowsMountedClosed} rows (${fit} fit in 480 px), open frames up to ${ms(phone.openFrameMaxMs)}`,
          pass: phone.rowsMountedClosed <= fit && phone.openFrameMaxMs < 17,
        };
      }),
  },
  {
    id: "B16",
    bounds: "Mounting the list, and mounting the rows that 100 rows of scrolling bring into view",
    threshold: "each ≤ half of the figure recorded in the Baseline column",
    baseline: "#151 writes its merge base's two figures, measured in the same run, here; B16 then enforces against those recorded numbers",
    measuredBy: "Chromium, 1,500 (production React)",
    kind: "timing",
    switchedOnBy: 151,
    enforcing: false,
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], (figure) => ({
        figure: `mount ${ms(figure.mountToFirstRowMs)}, scroll ${ms(figure.scrollMountMs)} (no baseline recorded yet)`,
        pass: null,
      })),
  },
  {
    id: "B17",
    bounds: "Renders on one thread's draft or row status change",
    threshold: "that row only",
    baseline: "that row (per-row hook)",
    measuredBy: "jsdom: events `draft change`, `row status change`",
    kind: "deterministic",
    switchedOnBy: 151,
    enforcing: false,
    read: (figures) =>
      events(["draft change", "row status change"], (event) => {
        const others = event.rowIds === null ? event.distinctRows : event.rowIds.filter((id) => id !== event.threadId).length;
        return { figure: `${event.distinctRows} rows`, pass: others === 0 };
      })(figures),
  },
  {
    id: "B18",
    bounds: "bb hooks per mounted row",
    threshold:
      "only `useSidebarThreadShortcut` (plus a pull request badge's lookup); `experimental_useSidebarThreadSplit` once per list, unless #151's PR records the drive step that failed with one call per list and passed with one per row",
    baseline: "five per row",
    measuredBy: "fake host call counts over one mount",
    kind: "deterministic",
    switchedOnBy: 151,
    enforcing: false,
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ hooksPerRow }) => {
        const used = Object.entries(hooksPerRow).filter(([, calls]) => calls > 0);
        const allowed = new Set(["useSidebarThreadShortcut", "experimental_useSidebarThreadPullRequest"]);
        return {
          figure: used.map(([name, calls]) => `${name} ${calls}`).join(", ") || "none",
          pass: used.every(([name]) => allowed.has(name)),
        };
      }),
  },
  {
    id: "B19",
    bounds: "Menus, context menus, hover cards and menu providers at rest",
    threshold:
      "at most one host per overlay the list draws (row menu, group menu, context menu, hover card) for the whole list, whatever the number of rows or groups",
    baseline: "about 4 providers per row",
    measuredBy: "jsdom, counting the third-party menu primitives' instances (Radix roots by their `<Root>Provider`)",
    kind: "deterministic",
    switchedOnBy: 151,
    enforcing: false,
    read: ({ jsdom }) =>
      acrossCells(CELLS, (cell) => jsdom[cell], ({ menuPrimitives: counts }) => ({
        figure: Object.entries(counts)
          .map(([name, count]) => `${name.replace(/Provider$/, "")} ${count}`)
          .join(", "),
        // Row menu and group menu are both dropdown menus.
        pass: (counts.DropdownMenuProvider ?? 0) <= 2 && (counts.ContextMenuProvider ?? 0) <= 1 && (counts.HoverCardProvider ?? 0) <= 1,
      })),
  },
  {
    id: "B20",
    bounds: "Requests when the list remounts (pull request badges' own lookups aside)",
    threshold:
      "none with the app overlay slot; exactly one `sync` and no bb request without it; in either case plus one batched fetch by id, only of threads in bb's list that the server holds as archived and the window has no row for",
    baseline: "8",
    measuredBy: "fake host",
    kind: "deterministic",
    switchedOnBy: 149,
    enforcing: false,
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ remount }) => {
        const other = Object.entries(remount.rpc).filter(([method]) => method !== "sync" && method !== "fetchArchived");
        // The fake host has no app overlay slot, so this is the case without
        // one: exactly one `sync`. The case with it is read once #149 adds it.
        return {
          figure: `${remount.rpcTotal} plugin RPC, ${remount.bbTotal} bb requests (no app overlay slot)`,
          pass: remount.bbTotal === 0 && other.length === 0 && remount.rpc.sync === 1 && (remount.rpc.fetchArchived ?? 0) <= 1,
        };
      }),
  },
  {
    id: "B21",
    bounds: "Requests on a window's first load",
    threshold:
      "≤ 1 plugin RPC, besides `importPreferences` on a device that never got an import answer and, with Show archived on, batched fetches of loaded archived rows, and one batched fetch by id, only of threads in bb's list that the server holds as archived and the window has no row for; bb requests only for what bb has not answered in this plugin's lifetime",
    baseline: "8",
    measuredBy: "fake host (a first load on a device that never got an import answer)",
    kind: "deterministic",
    switchedOnBy: 149,
    enforcing: false,
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ firstLoad }) => {
        const counted = Object.entries(firstLoad.rpc)
          .filter(([method]) => method !== "importPreferences" && method !== "fetchArchived")
          .reduce((sum, [, calls]) => sum + calls, 0);
        // A first load starts a plugin lifetime, so bb has answered none of its
        // requests yet; asking again what it answered is B20's remount.
        return { figure: `${counted} plugin RPC besides the import, ${firstLoad.bbTotal} bb requests`, pass: counted <= 1 };
      }),
  },
  {
    id: "B22",
    bounds: "Requests in 10 idle minutes",
    threshold: "no plugin RPC, no bb request from Thread Glance",
    baseline: "0",
    measuredBy: "fake host with a fake clock, one to three windows",
    kind: "deterministic",
    switchedOnBy: 145,
    enforcing: true,
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ idle }) => {
        const total = Object.values(idle).reduce((sum, requests) => sum + requests.rpcTotal + requests.bbTotal, 0);
        return {
          figure: Object.entries(idle)
            .map(([windows, requests]) => `${windows} window${windows === "1" ? "" : "s"}: ${requests.rpcTotal + requests.bbTotal}`)
            .join(", "),
          pass: total === 0,
        };
      }),
  },
  {
    id: "B23",
    bounds: "Realtime signals per thread event (active, idle, failed, interaction pending, turn failed)",
    threshold: "exactly one, applied to the list as one update",
    baseline: "up to 3 `stamps` + 1 `notes` per turn",
    measuredBy: "`server.test`; jsdom. Here: the plugin server on bb's fake plugin host",
    kind: "deterministic",
    switchedOnBy: 149,
    enforcing: false,
    read: ({ server }) => {
      if (server === undefined) return NOT_MEASURED;
      const counts = Object.entries(server.signalsPerEvent);
      return {
        figure: counts.map(([event, signals]) => `${event} ${signals}`).join(", "),
        pass: counts.every(([, signals]) => signals === 1),
      };
    },
  },
  {
    id: "B24",
    bounds: "`sync` payload",
    threshold: "first `sync` carries stamps and notes of active threads only; with nothing changed since the given revision, no stamps, no notes, < 1 KB",
    baseline: "24.5 KB + 19 KB per mount",
    measuredBy: "`server.test`. Until #149 adds `sync`, the figure is the `listStamps` and `listNotes` payload every mount loads, with every generated thread stamped and noted",
    kind: "deterministic",
    switchedOnBy: 149,
    enforcing: false,
    read: ({ server }) =>
      server === undefined
        ? NOT_MEASURED
        : {
            figure: `${(server.mountPayloadBytes.stamps / KB).toFixed(1)} KB stamps + ${(server.mountPayloadBytes.notes / KB).toFixed(1)} KB notes per mount, ${server.mountPayloadBytes.threads} threads`,
            pass: server.mountPayloadBytes.stamps + server.mountPayloadBytes.notes < KB,
          },
  },
  {
    id: "B25",
    bounds: "First read of stamps and notes after a server start, 5,000 stored threads",
    threshold: "< 10 ms each (`listStamps` and `listNotes` until #149, then the first `sync`)",
    baseline: "15.6 / 18.3 ms",
    measuredBy:
      "`server.test` SQLite-backed benchmark, which #147 adds, run by `npm run perf`. Until then, bb's fake plugin host with its KV in memory",
    kind: "timing",
    switchedOnBy: 147,
    enforcing: false,
    read: ({ server }) =>
      server === undefined
        ? NOT_MEASURED
        : {
            figure: `listStamps ${server.firstRead.stampsMs} ms, listNotes ${server.firstRead.notesMs} ms`,
            pass: server.firstRead.stampsMs < 10 && server.firstRead.notesMs < 10,
          },
  },
  {
    id: "B26",
    bounds: "`idleAt` writes per busy-to-idle transition",
    threshold: "one store and one signal, whatever the number of windows; no window request (apart from #147's missed-event case)",
    baseline: "one write per window",
    measuredBy: "`server.test`; fake host with 3 windows (`markIdle` calls, one write each)",
    kind: "deterministic",
    switchedOnBy: 147,
    enforcing: false,
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ idleAtWritesPerTransition: writes }) => ({
        figure: `${writes} window writes with 3 windows (the server's store and signal: server.test, from #147)`,
        pass: writes === 0,
      })),
  },
  {
    id: "B27",
    bounds: "Mark all read, one step",
    threshold: "every counted thread shown read in the first frame after the click; ≤ 2 list commits from click to the last request returning",
    baseline: "75 commits",
    measuredBy: "jsdom, MAR list, fake `setRead` taking 50 ms",
    kind: "deterministic",
    switchedOnBy: 153,
    enforcing: false,
    read: ({ markAllRead: { jsdom } }) =>
      jsdom === undefined
        ? NOT_MEASURED
        : {
            figure: `${jsdom.unreadAfterClick} of ${jsdom.counted} still unread after the click, ${jsdom.commits} commits`,
            pass: jsdom.unreadAfterClick === 0 && jsdom.commits <= 2,
          },
  },
  {
    id: "B28",
    bounds: "Mark all read, responsiveness",
    threshold: "INP < 100 ms at 1×, < 200 ms at 4×; plugin main-thread time from click to last request < 200 ms",
    baseline: "360 ms; 4.9 s",
    measuredBy: "Chromium, MAR list (production React)",
    kind: "timing",
    switchedOnBy: 153,
    enforcing: false,
    read: ({ markAllRead: { chromium } }) => {
      if (chromium === undefined) return NOT_MEASURED;
      const inp = inpReading(chromium.inp);
      return {
        figure: `INP ${inp.figure}, main thread ${ms(chromium.mainThreadMs)}`,
        pass: inp.pass === null ? null : inp.pass && chromium.mainThreadMs < 200,
      };
    },
  },
  {
    id: "B29",
    bounds: "Mark all read, requests",
    threshold: "at most six `setRead` in flight; one per counted thread; one `markSeen`",
    baseline: "448 at once",
    measuredBy: "fake host, MAR list",
    kind: "deterministic",
    switchedOnBy: 153,
    enforcing: false,
    read: ({ markAllRead: { host } }) =>
      host === undefined
        ? NOT_MEASURED
        : {
            figure: `${host.setRead} setRead for ${host.counted} counted, ${host.setReadPeak} in flight at once, ${host.markSeen} markSeen`,
            pass: host.setReadPeak <= 6 && host.setRead === host.counted && host.markSeen === 1,
          },
  },
];

/** A row's standing in one run. */
export interface Verdict {
  row: LedgerRow;
  reading: Reading;
  enforcing: boolean;
  /** Enforcing and over its threshold: the run fails. */
  failed: boolean;
}

/**
 * Reads every row off one run's figures. `enforce` switches further rows on
 * for this reading only, as a check that a row would fail its run does.
 */
export function evaluate(
  figures: Figures,
  { ledger = LEDGER, enforce = [] }: { ledger?: readonly LedgerRow[]; enforce?: readonly string[] } = {},
): Verdict[] {
  return ledger.map((row) => {
    const reading = row.read(figures);
    const enforcing = row.enforcing || enforce.includes(row.id);
    return { row, reading, enforcing, failed: enforcing && reading.pass === false };
  });
}

/** The verdicts that fail a run, as lines to report. */
export function failures(verdicts: readonly Verdict[]): string[] {
  return verdicts.filter((verdict) => verdict.failed).map(({ row, reading }) => `${row.id} (${row.bounds}): ${reading.figure}; threshold ${row.threshold}`);
}
