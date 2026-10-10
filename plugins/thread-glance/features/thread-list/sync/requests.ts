// The requests that fill the plugin's data: `sync`, and fetches by id of the
// thread records `sync` leaves out.
import type { PluginRpcClient, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { pluginData, type SyncAnswer } from "./plugin-data";

type Rpc = PluginRpcClient<RpcContract>;

/** Most thread ids one fetch by id names. */
const FETCH_BATCH = 500;

let syncing = false;
let again = false;

/**
 * Why a `sync` is asked: `current` to make what is held current, which one
 * in flight already does, or `missed` for what realtime dropped, which one
 * sent before it may not hold.
 */
export type SyncReason = "current" | "missed";

/**
 * Asks for what changed since the window's revision, or everything when it
 * has seen nothing. One at a time: a call while one runs joins it, or,
 * for what realtime dropped, runs once more after it.
 */
export async function requestSync(rpc: Rpc, reason: SyncReason): Promise<void> {
  if (syncing) {
    if (reason === "missed") again = true;
    return;
  }
  syncing = true;
  try {
    do {
      again = false;
      try {
        const answer = (await rpc.call("sync", { since: pluginData.get().records.point })) as SyncAnswer;
        pluginData.synced(answer);
      } catch {
        pluginData.failed();
      }
    } while (again);
  } finally {
    syncing = false;
  }
}

/** Fetches by id, in batches, the records of threads in bb's list that `sync` left out. */
export function fetchMissing(rpc: Rpc, threads: readonly PluginSidebarThread[]): void {
  const ids = pluginData.takeThreadsToFetch(threads);
  for (let start = 0; start < ids.length; start += FETCH_BATCH) {
    const batch = ids.slice(start, start + FETCH_BATCH);
    rpc.call("fetchArchived", { threadIds: batch }).then(
      (answer) => pluginData.fetched(batch, answer),
      () => undefined,
    );
  }
}

/** Forgets a sync in flight, as a reload of the app does. For tests. */
export function forgetRequests(): void {
  syncing = false;
  again = false;
}
