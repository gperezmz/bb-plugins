// The budget ledger of the Thread Glance list: every performance budget the
// list holds, one row each. Nothing else holds a budget, and every row
// enforces: the run that measures a row fails when its threshold is missed.
// Rows of kind "deterministic" (render counts, rows mounted, requests,
// signals, writes, bundle size) run in `npm test`, and so in CI. Rows of kind
// "timing" (INP, milliseconds, heap) run in `npm run perf`, outside CI, and a
// change that touches the list records their output in its pull request. A
// row of kind "both" has a part of each, taken by the run of each.
//
// Terms the rows use:
// - harness: this ledger's synthetic run, over generated lists;
// - jsdom: its render counts, taken on React's development build, which
//   counts renders as the production build does, in an 800 px tall window,
//   so the list mounts about the rows a sidebar shows;
// - Chromium: its browser run (vitest browser mode, Playwright), which times
//   React's production build, the build bb ships;
// - fake host: its fake bb and plugin server, which count requests;
// - generated list: a list the harness makes from a seed (`generateList` in
//   features/thread-list/testing/fixtures.ts), of 50, 300 or 1,500 threads:
//   the live list, with nothing settled yet, or the settled list, two days
//   on, where read thread trees sit behind their Settled fold;
// - MAR list: the Mark all read list, 1,500 threads with 443 unread;
// - real drive: a drive of real bb threads with the driving-bb-plugins
//   skill, which takes the rows its `timings` recipes name at its own size.
// "Measured by" is the synthetic harness at the sizes it names, 1,500
// included; any figure a real drive takes for a row is measured at that
// drive's size, not at 1,500.
//
// How the rows read what they measure:
// - In jsdom, which lays nothing out, a thread "off screen" is a child thread
//   behind its closed children chip, which has no row mounted. In Chromium it
//   is a thread scrolled out of view.
// - The Settled fold exists only where something is settled, so its INP is
//   taken on the settled list; the live list reports n/a.
// - A row "renders" when the outermost component around its anchor
//   (`data-sidebar-thread-id`) runs; group headers and the list header
//   likewise by `data-sidebar="group-label"` and `data-sidebar="list-header"`
//   (perf/harness/render-counter.ts).
import type { Cell, Figures } from "./figures";
import { CELLS } from "./figures";
import type { InpFigure } from "./harness/chromium-figures";
import { scriptFigure } from "./harness/cpu-profile";
import type { EventFigure } from "./harness/jsdom-run";

export type Kind = "deterministic" | "timing" | "both";

/** A row's figure from one run: what it read, and whether that meets the threshold (null: not measured here). */
interface Reading {
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

/** The commit B16's Baseline column was measured on: #159's merge base. */
const B16_BASE = "8aab2ae";

/** B16's Baseline column in ms: #159's merge base, the median of 3 runs. */
const B16_BASELINE = {
  "1500/live": { mount: 624.7, scroll: 35.3 },
  "1500/settled": { mount: 72.4, scroll: 20.2 },
} as const;

/** One frame, as B16's scroll figure measures it: no list lands a row sooner. */
const B16_FRAME_MS = 17.8;

/** #159's own medians in ms, from the runs that alternated with the baseline's. */
const B16_HEAD = {
  "1500/live": { mount: 103.6, scroll: 17.8 },
  "1500/settled": { mount: 52.2, scroll: 17.1 },
} as const;

const b16Figures = (figures: Record<string, { mount: number; scroll: number }>) =>
  Object.entries(figures)
    .map(([cell, { mount, scroll }]) => `${cell} mount ${mount} ms, scroll ${scroll} ms`)
    .join("; ");

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
    id: "B2",
    bounds: "`app.js` size",
    threshold: "≤ 250 KB raw and ≤ 80 KB gzip",
    baseline: "511 KB / 149 KB",
    measuredBy: "bundle check (`bb plugin build`, KB = 1,000 bytes), in `npm test`",
    kind: "deterministic",
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
    baseline:
      "110–134 ms (0.7.0). After #148's list store, worst of the four events per cell, one sample each: 50/live 6 ms, 50/settled 3 ms, 300/live 13 ms, 300/settled 4 ms, 1500/live 13 ms, 1500/settled 10 ms; other runs of the same code put 1500/live at 20–21 ms and 1500/settled at 18 ms",
    measuredBy: "Chromium, 1,500, live and settled (production React; script time through the DevTools protocol)",
    kind: "timing",
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
    read: (figures) => events(["split layout"], changedOnly)(figures),
  },
  {
    id: "B8",
    bounds: "Renders caused by the list's drop feedback",
    threshold: "≤ 2 rows per change of target, none when the target is unchanged",
    baseline: "every mounted row per move",
    measuredBy: "jsdom: 50 changes of the store's drop feedback with dnd-kit's state held constant (the `dropFeedback` figures)",
    kind: "deterministic",
    read: ({ jsdom }) =>
      acrossCells(CELLS, (cell) => jsdom[cell], ({ dropFeedback: feedback }) => ({
        figure: `up to ${feedback.maxRowsOnChange} rows per change of target, ${feedback.rowsOnUnchanged} on unchanged steps`,
        pass: feedback.maxRowsOnChange <= 2 && feedback.rowsOnUnchanged === 0,
      })),
  },
  {
    id: "B9",
    bounds: "All renders over 50 drag moves",
    threshold:
      "no thread row apart from the dragged row, once when the drag starts and once when it ends; feedback drawn only where the target changes",
    baseline: "every mounted row per move",
    measuredBy: "jsdom: 50 drag moves over rows (the `drag` figures)",
    kind: "deterministic",
    read: ({ jsdom }) =>
      acrossCells(CELLS, (cell) => jsdom[cell], ({ drag }) => ({
        figure: `${drag.otherRows} renders of other rows over ${drag.moves} moves (${drag.rowsOnUnchanged} on unchanged moves, up to ${drag.maxRowsOnChange} per change, ${drag.targetChanges} changes of target)`,
        pass: drag.otherRows === 0 && drag.targetChanges > 0,
      })),
  },
  {
    id: "B10",
    bounds:
      'Rows mounted, however scrolled and after any group, children chip, "N more child threads", environment or Settled fold opens or closes',
    threshold:
      "exactly the rows intersecting the view extended 240 px above and below, plus the rows that must stay mounted, plus each group's header",
    baseline: "most rows",
    measuredBy:
      "Chromium, 1,500, mounted anchors against computed positions. The rows that must stay mounted include the first nine thread rows, which bb 0.44's jump keys reach among mounted rows only",
    kind: "deterministic",
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
      "Chromium Event Timing, 1,500 (production React). The Settled fold's is taken on the settled list only; the live list reports n/a. A real drive takes the group's and a children chip's too (`perf-open`): the harness reads them lower than bb does (96–120 ms against about 400 ms, on 0.7.0)",
    kind: "timing",
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
    measuredBy:
      "Chromium, 1,500 (production React). A real drive takes it too (`perf-return`): the harness reads it lower than bb does (about 0.6 s against 2.2 s, on 0.7.0)",
    kind: "timing",
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
      "Chromium through the DevTools protocol, 1,500 (HeapProfiler.collectGarbage, Runtime.queryObjects, DOM.getDetachedDomNodes). A real drive takes the observers and detached nodes too (`perf-return`, 10 returns from bb's Settings). Its heap figure is the page's and depends on bb, not on Thread Glance: on a 50-thread drive the page's heap grew +3.8 MB with Thread Glance and +5.3 MB with bb's own list over the same returns, so the heap part is read in the harness only",
    kind: "timing",
    read: ({ chromium }) =>
      acrossCells(AT_1500, (cell) => chromium[cell], ({ cycles }) => {
        const grew = (series: number[], from = 0) => series.length > from + 1 && series.at(-1)! > series[from]!;
        return {
          figure: `heap +${(cycles.heapGrowthBytes / 1_000_000).toFixed(2)} MB, IntersectionObserver ${cycles.intersectionObservers.join("→")}, ResizeObserver ${cycles.resizeObservers.join("→")}, detached nodes ${cycles.detachedNodes.join("→")}`,
          pass:
            cycles.heapGrowthBytes < 500_000 &&
            !grew(cycles.intersectionObservers) &&
            !grew(cycles.resizeObservers) &&
            // Growing, not a step: the test runtime keeps the empty container
            // each list mounted in, which the first remount adds, and the
            // count holds from there.
            !grew(cycles.detachedNodes, 1),
        };
      }),
  },
  {
    id: "B14",
    bounds: "Renders for a new thread, or a thread moving up or down",
    threshold:
      "its own row, rows whose drawn content changed, and rows the change brings into the mounted range; a row mounted before and after whose only change is its position does not render; its group header and the list header only when a count or flag they show changed",
    baseline: "255 rows remounted",
    measuredBy: "jsdom, 1,500: events `new thread`, `thread moves`",
    kind: "deterministic",
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
    threshold: `the 1,500 live list mounts in at most half its merge base's time, and scrolling lands a row within one frame (≤ ${B16_FRAME_MS} ms)`,
    baseline: `#159's merge base (${B16_BASE}), median of 3 runs alternating with #159's own on one machine and Chromium: ${b16Figures(B16_BASELINE)}. #159's medians in the same runs: ${b16Figures(B16_HEAD)}. The settled list's figures left the row, restated with #159: it holds 77 rows, which the merge base also draws whole, and its mount is the derive step's`,
    measuredBy:
      "Chromium, 1,500 (production React). Scroll is from setting the scroll position to the first frame after a row lands fully in view, so it is never under one frame (about 17 ms)",
    kind: "timing",
    read: ({ chromium }) =>
      acrossCells(["1500/live"], (cell) => chromium[cell], (figure) => {
        const limit = B16_BASELINE["1500/live"].mount / 2;
        return {
          figure: `mount ${ms(figure.mountToFirstRowMs)} (limit ${ms(limit)}), scroll ${ms(figure.scrollMountMs)} (limit ${B16_FRAME_MS} ms)`,
          pass: figure.mountToFirstRowMs <= limit && figure.scrollMountMs <= B16_FRAME_MS,
        };
      }),
  },
  {
    id: "B17",
    bounds: "Renders on one thread's draft or row status change",
    threshold: "that row only",
    baseline: "that row (per-row hook)",
    measuredBy: "jsdom: events `draft change`, `row status change`",
    kind: "deterministic",
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
      "only `useSidebarThreadShortcut` (plus a pull request badge's lookup); `experimental_useSidebarThreadSplit` once per list",
    baseline: "five per row",
    measuredBy:
      "fake host call counts over one mount. `experimental_useSidebarThreadSplit` counts as once per list while its calls over the mount stay at 2 or fewer, the list's own renders, whatever the number of rows",
    kind: "deterministic",
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ hooksPerRow, hookCalls }) => {
        const split = "experimental_useSidebarThreadSplit";
        const used = Object.entries(hooksPerRow).filter(([name, calls]) => calls > 0 || (name === split && (hookCalls?.[split] ?? 0) > 0));
        const allowed = new Set(["useSidebarThreadShortcut", "experimental_useSidebarThreadPullRequest"]);
        const oncePerList = (name: string) => name === split && hookCalls !== undefined && hookCalls[split]! <= 2;
        return {
          figure:
            used
              .map(([name, calls]) => (name === split && hookCalls !== undefined ? `${name} ${hookCalls[split]} over the mount` : `${name} ${calls}`))
              .join(", ") || "none",
          pass: used.every(([name]) => allowed.has(name) || oncePerList(name)),
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
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ remount, remountWithOverlay }) => {
        const besides = (requests: typeof remount, allowed: readonly string[]) =>
          Object.keys(requests.rpc).filter((method) => !allowed.includes(method) && method !== "fetchArchived");
        const fetches = (requests: typeof remount) => requests.rpc.fetchArchived ?? 0;
        // Without the slot the list follows realtime itself, so it asks what
        // it missed: exactly one `sync`. With it, the overlay's keeper followed
        // throughout, so nothing.
        const without = remount.bbTotal === 0 && besides(remount, ["sync"]).length === 0 && remount.rpc.sync === 1;
        const withSlot = remountWithOverlay.bbTotal === 0 && besides(remountWithOverlay, []).length === 0;
        return {
          figure:
            `with the app overlay slot ${remountWithOverlay.rpcTotal} plugin RPC, ${remountWithOverlay.bbTotal} bb requests; ` +
            `without it ${remount.rpcTotal} plugin RPC, ${remount.bbTotal} bb requests`,
          pass: without && withSlot && fetches(remount) <= 1 && fetches(remountWithOverlay) <= 1,
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
    measuredBy: "jsdom. Here: the plugin server on bb's fake plugin host, one of each event",
    kind: "deterministic",
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
    measuredBy:
      "`server.test`. Here: the plugin server on bb's fake plugin host, every thread of the 1,500-thread generated list stamped and noted and a tenth of them archived",
    kind: "deterministic",
    read: ({ server }) => {
      if (server === undefined) return NOT_MEASURED;
      const payload = server.syncPayload;
      return {
        figure:
          `first ${(payload.firstBytes / KB).toFixed(1)} KB, ${payload.firstRecords} records (${payload.firstArchivedRecords} archived) of ${payload.threads} threads; ` +
          `unchanged ${payload.unchangedBytes} bytes, ${payload.unchangedRecords} records`,
        pass:
          payload.firstArchivedRecords === 0 &&
          payload.firstRecords === payload.threads - payload.archived &&
          payload.unchangedRecords === 0 &&
          payload.unchangedBytes < KB,
      };
    },
  },
  {
    id: "B25",
    bounds: "First read of stamps and notes after a server start, 5,000 stored threads",
    threshold: "< 10 ms (the first `sync`)",
    baseline:
      "15.6 / 18.3 ms (0.7.0); 16.2–17.2 / 16.2–16.4 ms after #147's batched reads, on bb 0.44's SQLite-backed KV (measured in PR #156)",
    measuredBy:
      "The `sync` handler, from the request to its answer object, cold after a restart, over 5,000 stored threads in the plugin's own SQLite database, by `npm run perf` on bb's fake plugin host. The host's whole call, with its checks of the answer and its JSON, is recorded beside it for information and is not held to the threshold",
    kind: "timing",
    read: ({ server }) =>
      server === undefined
        ? NOT_MEASURED
        : {
            figure: `first sync ${server.firstRead.handlerMs} ms (host's whole call ${server.firstRead.callMs} ms)`,
            pass: server.firstRead.handlerMs < 10,
          },
  },
  {
    id: "B26",
    bounds: "`idleAt` writes per busy-to-idle transition",
    threshold: "one store and one signal, whatever the number of windows; no window request, apart from a change to idle bb sends the server no event for",
    baseline: "one write per window",
    measuredBy:
      "`server.test` (the store and the signal: \"records a thread going idle once\"); fake host with 3 windows (window requests, `reportIdle`, when a turn ends, which bb announces)",
    kind: "deterministic",
    read: ({ host }) =>
      acrossCells(CELLS, (cell) => host[cell], ({ idleAtWritesPerTransition: writes }) => ({
        figure: `${writes} window requests with 3 windows`,
        pass: writes === 0,
      })),
  },
  {
    id: "B27",
    bounds: "Mark all read, one step",
    threshold: "every counted thread shown read in the first frame after the click; ≤ 2 list commits from click to the last request returning",
    baseline: "75 commits (0.7.0, counting every React commit, the edge's included)",
    measuredBy:
      "jsdom, MAR list, fake `threads.markRead` taking 50 ms. A list commit is one that renders a row, a group header or the list header: the list's edge renders on every update bb sends and draws nothing, so it is not counted",
    kind: "deterministic",
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
    measuredBy:
      "Chromium, MAR list (production React), fake `threads.markRead` taking 50 ms. The main-thread time is a CPU profile's samples from the click to the last answer, at 1×, in the plugin's modules, React and the libraries Vite bundles, native work (DOM calls, garbage collection) counted as its caller's, and shared Vite files no URL names counted as the plugin's, so it errs high; the fake bb's and the rest (test runner, native time) are reported beside it and not held to the threshold",
    kind: "timing",
    read: ({ markAllRead: { chromium } }) => {
      if (chromium === undefined) return NOT_MEASURED;
      const inp = inpReading(chromium.inp);
      return {
        figure: `INP ${inp.figure}, ${scriptFigure(chromium.script)}`,
        pass: inp.pass === null ? null : inp.pass && chromium.script.pluginMs < 200,
      };
    },
  },
  {
    id: "B29",
    bounds: "Mark all read, requests",
    threshold: "at most six `threads.markRead` in flight; one per counted thread; one `markSeen`",
    baseline: "448 `setRead` at once",
    measuredBy: "fake host, MAR list, with its unread child threads done-unseen",
    kind: "deterministic",
    read: ({ markAllRead: { host } }) =>
      host === undefined
        ? NOT_MEASURED
        : {
            figure: `${host.markRead} markRead for ${host.counted} counted, ${host.markReadPeak} in flight at once, ${host.markSeen} markSeen`,
            pass: host.markReadPeak <= 6 && host.markRead === host.counted && host.markSeen === 1,
          },
  },
];

/** A row's standing in one run. */
export interface Verdict {
  row: LedgerRow;
  reading: Reading;
  /** Over its threshold: the run fails. */
  failed: boolean;
}

/** Reads every row off one run's figures. */
export function evaluate(figures: Figures): Verdict[] {
  return LEDGER.map((row) => {
    const reading = row.read(figures);
    return { row, reading, failed: reading.pass === false };
  });
}

/** The verdicts that fail a run, as lines to report. */
export function failures(verdicts: readonly Verdict[]): string[] {
  return verdicts.filter((verdict) => verdict.failed).map(({ row, reading }) => `${row.id} (${row.bounds}): ${reading.figure}; threshold ${row.threshold}`);
}
