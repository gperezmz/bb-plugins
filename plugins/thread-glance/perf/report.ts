// Prints a run's figures, one table per generated list, and the ledger's
// reading of them.
import { CELLS, type Cell, type Figures } from "./figures";
import type { Verdict } from "./ledger";

function table(title: string, rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([name]) => name.length), 6);
  const lines = rows.map(([name, value]) => `  ${name.padEnd(width)}  ${value}`);
  return [`${title}`, ...lines].join("\n");
}

function msValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `${Math.round(value)} ms`;
}

/** An INP; Event Timing reports nothing under 16 ms, which the run records as 0. */
function inpValue(value: number | null): string {
  return value === 0 ? "< 16 ms" : msValue(value);
}

function cellRows(figures: Figures, cell: Cell | "snapshot"): [string, string][] {
  const rows: [string, string][] = [];
  const jsdom = cell === "snapshot" ? figures.snapshot : figures.jsdom[cell];
  if (jsdom !== undefined) {
    rows.push(["threads / rows mounted (jsdom)", `${jsdom.threads} / ${jsdom.mountedRows}, ${jsdom.groups} groups`]);
    for (const [name, event] of Object.entries(jsdom.events)) {
      rows.push([
        `jsdom: ${name}`,
        `${event.rows} row renders (${event.distinctRows} rows, ${event.extraRows} unchanged), ${event.groupHeaders} group headers, ${event.listHeader} list header (${event.extraHeaders} unchanged), ${event.commits} commits, ${event.jsMs} ms`,
      ]);
    }
    const { drag, minuteTick: tick } = jsdom;
    rows.push([
      "jsdom: 50 drag moves",
      `${drag.otherRows} other-row renders, ${drag.targetChanges} target changes (up to ${drag.maxRowsOnChange} rows each), ${drag.rowsOnUnchanged} on unchanged moves, ${drag.commits} commits, ${drag.jsMs} ms`,
    ]);
    rows.push([
      "jsdom: minute tick",
      `${tick.rendered} rendered, ${tick.expected} changed (${tick.extra} extra, ${tick.missed} missed), ${tick.hidden} while hidden`,
    ]);
    rows.push(["jsdom: menu primitives at rest", Object.entries(jsdom.menuPrimitives).map(([name, count]) => `${name} ${count}`).join(", ")]);
  }
  if (cell === "snapshot") return rows;
  const host = figures.host[cell];
  if (host !== undefined) {
    const requests = (label: string, value: { rpcTotal: number; bbTotal: number; rpc: Record<string, number> }) =>
      [label, `${value.rpcTotal} plugin RPC (${Object.entries(value.rpc).map(([method, calls]) => `${method} ${calls}`).join(", ") || "none"}), ${value.bbTotal} bb requests`] as [string, string];
    rows.push(requests("fake host: first load", host.firstLoad));
    rows.push(requests("fake host: remount", host.remount));
    for (const [windows, idle] of Object.entries(host.idle)) rows.push(requests(`fake host: 10 idle minutes, ${windows} window(s)`, idle));
    rows.push(["fake host: idleAt requests when a turn ends, 3 windows", String(host.idleAtWritesPerTransition)]);
    rows.push(["fake host: per-row hooks per mounted row", Object.entries(host.hooksPerRow).map(([name, calls]) => `${name} ${calls}`).join(", ")]);
  }
  const chromium = figures.chromium[cell];
  if (chromium !== undefined) {
    const inp = (value: { x1: number | null; x4: number | null } | null) => (value === null ? "n/a" : `${inpValue(value.x1)} at 1×, ${inpValue(value.x4)} at 4×`);
    rows.push([`Chromium (${chromium.build} React): INP open group`, inp(chromium.inp.group)]);
    rows.push(["Chromium: INP open children chip", inp(chromium.inp.childrenChip)]);
    rows.push(["Chromium: INP open Settled fold", inp(chromium.inp.settledFold)]);
    rows.push(["Chromium: mount / remount to first row", `${msValue(chromium.mountToFirstRowMs)} / ${msValue(chromium.remountToFirstRowMs)}`]);
    rows.push(["Chromium: rows 100 rows of scrolling bring in", msValue(chromium.scrollMountMs)]);
    rows.push(["Chromium: rows mounted", String(chromium.rowsMounted)]);
    rows.push(["Chromium: rows outside view ±240 px / missing", `${chromium.window.excess} / ${chromium.window.missing} over ${chromium.window.checks} checks`]);
    rows.push([
      "Chromium: 10 remounts after GC",
      `heap +${(chromium.cycles.heapGrowthBytes / 1_000_000).toFixed(2)} MB, IntersectionObserver ${chromium.cycles.intersectionObservers.join("→")}, ResizeObserver ${chromium.cycles.resizeObservers.join("→")}, detached nodes ${chromium.cycles.detachedNodes.join("→")}`,
    ]);
    rows.push(["Chromium: JS per realtime event", Object.entries(chromium.eventJsMs).map(([name, value]) => `${name} ${msValue(value)}`).join(", ")]);
    rows.push([
      "Chromium: phone 390×844",
      `closed ${chromium.phone.rowsMountedClosed} rows (row ${chromium.phone.rowHeightPx} px), open scroll frames max ${msValue(chromium.phone.openFrameMaxMs)}, p95 ${msValue(chromium.phone.openFrameP95Ms)}`,
    ]);
  }
  return rows;
}

/** Every table of a run, and the ledger's reading, as text. */
export function formatReport(figures: Figures, verdicts: readonly Verdict[]): string {
  const sections: string[] = [];
  for (const cell of CELLS) {
    const rows = cellRows(figures, cell);
    if (rows.length > 0) sections.push(table(`${cell.replace("/", " threads, ")}`, rows));
  }
  if (figures.snapshot) sections.push(table("Snapshot (PERF_THREADS)", cellRows(figures, "snapshot")));
  const { markAllRead: mar, server, bundle } = figures;
  const shared: [string, string][] = [];
  if (mar.jsdom) shared.push(["MAR list, jsdom", `${mar.jsdom.unreadAfterClick} of ${mar.jsdom.counted} unread after the click, ${mar.jsdom.commits} commits, ${mar.jsdom.jsMs} ms`]);
  if (mar.host) shared.push(["MAR list, fake host", `${mar.host.setRead} setRead, ${mar.host.setReadPeak} in flight at once, ${mar.host.markSeen} markSeen`]);
  if (mar.chromium) shared.push(["MAR list, Chromium", `INP ${inpValue(mar.chromium.inp.x1)} at 1×, ${inpValue(mar.chromium.inp.x4)} at 4×, main thread ${msValue(mar.chromium.mainThreadMs)}`]);
  if (server) {
    shared.push(["server: signals per thread event", Object.entries(server.signalsPerEvent).map(([name, count]) => `${name} ${count}`).join(", ")]);
    shared.push(["server: stamps + notes per mount", `${server.mountPayloadBytes.stamps} + ${server.mountPayloadBytes.notes} bytes, ${server.mountPayloadBytes.threads} threads`]);
    shared.push(["server: first read, 5,000 threads", `listStamps ${server.firstRead.stampsMs} ms, listNotes ${server.firstRead.notesMs} ms`]);
  }
  if (bundle) shared.push(["app.js", `${bundle.rawBytes} bytes raw, ${bundle.gzipBytes} gzip, ${bundle.brotliBytes} brotli`]);
  if (shared.length > 0) sections.push(table("Mark all read list, server and bundle", shared));
  sections.push(
    table(
      "Budget ledger (perf/ledger.ts)",
      verdicts.map(({ row, reading, enforcing }) => [
        `${row.id} ${row.kind}${enforcing ? ", enforcing" : ""}`,
        `${reading.pass === null ? "–" : reading.pass ? "met" : "missed"}: ${reading.figure}`,
      ]),
    ),
  );
  return sections.join("\n\n");
}

/** The same numbers as JSON, with the ledger's reading beside them. */
export function reportJson(figures: Figures, verdicts: readonly Verdict[]): string {
  return JSON.stringify(
    {
      figures,
      ledger: verdicts.map(({ row, reading, enforcing, failed }) => ({
        id: row.id,
        kind: row.kind,
        switchedOnBy: row.switchedOnBy,
        enforcing,
        figure: reading.figure,
        pass: reading.pass,
        failed,
      })),
    },
    null,
    2,
  );
}
