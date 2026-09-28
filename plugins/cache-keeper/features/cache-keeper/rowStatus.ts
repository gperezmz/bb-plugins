/**
 * The sidebar glyph: the timer on a row while its compaction is due, the
 * flame while a keep-warm is planned. A content script, so it
 * polls the server through `fetchRowStatuses` rather than using hooks.
 */
import type { PluginContentScriptContext, PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import type { RowStatus } from "@/src/core/view";
import { FLAME_ICON, fetchRowStatuses, TIMER_ICON } from "./api";

const POLL_MS = 20_000;

/** The glyph and label a row shows for each of Cache Keeper's statuses. */
export const ROW_GLYPHS: Record<RowStatus, PluginSidebarThreadRowStatus> = {
  compaction: { icon: TIMER_ICON, label: "Cache Keeper: compacting before the cache goes cold" },
  "keep-warm": { icon: FLAME_ICON, label: "Cache Keeper: keeping the cache warm while it waits" },
};

export function mountRowStatus(context: PluginContentScriptContext): () => void {
  const set = context.experimental_setThreadRowStatus;
  // bb versions without the surface show the chip and banner only.
  if (set === undefined) return () => {};
  let shown = new Set<string>();
  const load = async () => {
    const list = await fetchRowStatuses(context.signal);
    const next = new Set<string>();
    for (const row of list) {
      next.add(row.threadId);
      set(row.threadId, ROW_GLYPHS[row.status]);
    }
    for (const id of shown) if (!next.has(id)) set(id, null);
    shown = next;
  };
  const tick = () => void load().catch(() => {});
  tick();
  const timer = setInterval(tick, POLL_MS);
  return () => {
    clearInterval(timer);
    for (const id of shown) set(id, null);
  };
}
