/**
 * The sidebar glyph: Cache Keeper's icon on a row while its compaction is
 * due, a clock while a keep-warm or check-in is due. A content script, so it
 * reads the server over plain HTTP and polls rather than using hooks.
 */
import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { KEEPER_ICON, PLUGIN_ID } from "./api";

const POLL_MS = 20_000;

type RowStatus = { threadId: string; status: "compaction" | "clock" };

export function mountRowStatus(context: PluginContentScriptContext): () => void {
  const set = context.experimental_setThreadRowStatus;
  // bb versions without the surface show the chip and banner only.
  if (set === undefined) return () => {};
  let shown = new Set<string>();
  const load = async () => {
    const res = await fetch(`/api/v1/plugins/${PLUGIN_ID}/rpc/rowStatuses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
      signal: context.signal,
    });
    if (!res.ok) return;
    const rows = (await res.json()) as RowStatus[] | { result?: RowStatus[] };
    const list = Array.isArray(rows) ? rows : (rows.result ?? []);
    const next = new Set<string>();
    for (const row of list) {
      next.add(row.threadId);
      set(
        row.threadId,
        row.status === "compaction"
          ? { icon: KEEPER_ICON, label: "Cache Keeper: compacting before the cache goes cold" }
          : { icon: "Clock", label: "Cache Keeper: keeping the cache warm while it waits" },
      );
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
