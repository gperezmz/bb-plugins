// The request that fills the plugin's data: `sync`.
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { pluginData, type SyncAnswer } from "./plugin-data";

type Rpc = PluginRpcClient<RpcContract>;

/** The wait before the first retry of a failed `sync`, doubled for each failure after it. */
const RETRY_BASE_MS = 2_000;
/** The longest wait between retries. */
const RETRY_MAX_MS = 60_000;

let syncing = false;
let again = false;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Why a `sync` is asked: `current` to make what is held current, which one
 * in flight already does, or `missed` for what realtime dropped, which one
 * sent before it may not hold.
 */
export type SyncReason = "current" | "missed";

/**
 * Asks for what changed since the window's revision, or everything when it
 * has seen nothing. One at a time: a call while one runs joins it, or,
 * for what realtime dropped, runs once more after it. A failed `sync` is
 * asked again with a growing wait for as long as a keeper follows realtime,
 * since the signals it buffers wait for an answer.
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
        failures = 0;
      } catch {
        pluginData.failed();
        scheduleRetry(rpc);
      }
    } while (again);
  } finally {
    syncing = false;
  }
}

function scheduleRetry(rpc: Rpc): void {
  if (retryTimer !== null || !pluginData.isFollowing()) return;
  const wait = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
  failures += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (pluginData.isFollowing()) void requestSync(rpc, "current");
  }, wait);
}

/** Forgets a sync in flight, as a reload of the app does. For tests. */
export function forgetRequests(): void {
  syncing = false;
  again = false;
  failures = 0;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}
