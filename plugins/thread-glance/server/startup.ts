// Work done once per server start, in a background service because `bb.sdk`
// is bind-gated in the factory.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ScheduledTracker } from "./scheduled";

const THREAD_PAGE_SIZE = 500;
const SEED_RETRY_MS = 60_000;

type Sdk = BbPluginApi["sdk"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Returns the id of every thread bb has, archived and hidden ones included.
 *
 * It lists active and archived threads separately and pages each with
 * limit and offset, since the list is capped per call.
 */
export async function listAllThreadIds(sdk: Sdk, signal?: AbortSignal): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const archived of [false, true]) {
    for (let offset = 0; ; offset += THREAD_PAGE_SIZE) {
      const page = await sdk.threads.list({
        archived,
        includeHidden: true,
        limit: THREAD_PAGE_SIZE,
        offset,
        signal,
      });
      for (const thread of page) ids.add(thread.id);
      if (page.length < THREAD_PAGE_SIZE) break;
    }
  }
  return ids;
}

/** A per-thread store, such as stamps or notes, that startup prunes. */
export interface PrunableStore {
  /** What the store holds, for the log line. */
  name: string;
  prune(liveIds: ReadonlySet<string>, before: number): Promise<string[]>;
}

/** Drops per-thread rows of threads bb no longer has. Logs and returns on failure. */
export async function pruneDeletedThreads(
  bb: Pick<BbPluginApi, "sdk" | "log">,
  stores: readonly PrunableStore[],
  signal?: AbortSignal,
): Promise<void> {
  const before = Date.now();
  let live: Set<string>;
  try {
    live = await listAllThreadIds(bb.sdk, signal);
  } catch (error) {
    bb.log.warn(`could not list threads to prune deleted ones: ${errorMessage(error)}`);
    return;
  }
  for (const store of stores) {
    const pruned = await store.prune(live, before);
    if (pruned.length > 0) {
      bb.log.info(`pruned ${store.name} of ${pruned.length} deleted threads`);
    }
  }
}

/** Seeds the scheduled-send tracker from every queued row in bb. */
export function seedScheduled(
  bb: Pick<BbPluginApi, "sdk" | "log">,
  tracker: ScheduledTracker,
  signal?: AbortSignal,
): Promise<boolean> {
  return tracker.seed(async () => {
    try {
      return await bb.sdk.threads.queue.list({ signal });
    } catch (error) {
      bb.log.warn(`could not list queued messages: ${errorMessage(error)}`);
      throw error;
    }
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

/**
 * The `startup` service: seeds scheduled sends, retrying every minute until
 * one seed succeeds, prunes `stores` once, then waits for `signal` to abort.
 */
export async function runStartup(
  bb: Pick<BbPluginApi, "sdk" | "log">,
  stores: readonly PrunableStore[],
  tracker: ScheduledTracker,
  signal: AbortSignal,
  retryMs = SEED_RETRY_MS,
): Promise<void> {
  const seeded = seedScheduled(bb, tracker, signal);
  await pruneDeletedThreads(bb, stores, signal);
  let ok = await seeded;
  while (!ok && !signal.aborted) {
    await sleep(retryMs, signal);
    if (signal.aborted) break;
    ok = await seedScheduled(bb, tracker, signal);
  }
  await waitForAbort(signal);
}
