// What the thread menu knows of bb's `parentNotifications` for the threads it
// shows. bb calls each registration's `useData` separately, so the reads are
// held once for the window: a thread is read when it enters the set of
// threads the menus show, and again each time it re-enters. A change made
// elsewhere, such as `bb thread update`, shows once the thread next re-enters.
import { useEffect, useSyncExternalStore } from "react";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { isParentNotifications, type ParentNotifications } from "./model/notify";

let values: ReadonlyMap<string, ParentNotifications> = new Map();
/** The threads the menus showed at the last request, so only one that just entered is read. */
let requested: ReadonlySet<string> = new Set();
/** Which read or write of a thread is the latest, so an older answer that arrives after it is dropped. */
const versions = new Map<string, number>();
let users = 0;
/** Which stretch of use an answer belongs to, so one that comes back after the menu data unmounted is dropped. */
let epoch = 0;
const listeners = new Set<() => void>();

function store(threadId: string, value: ParentNotifications): void {
  if (values.get(threadId) === value) return;
  values = new Map(values).set(threadId, value);
  for (const notify of [...listeners]) notify();
}

function nextVersion(threadId: string): number {
  const version = (versions.get(threadId) ?? 0) + 1;
  versions.set(threadId, version);
  return version;
}

/** Reads bb's setting for a thread; one that cannot be read stays unknown. */
function read(sdk: PluginBrowserBbSdk, threadId: string): void {
  const stretch = epoch;
  const version = nextVersion(threadId);
  Promise.resolve()
    .then(() => sdk.threads.get({ threadId }))
    .then(
      (found) => {
        if (stretch !== epoch || versions.get(threadId) !== version) return;
        if ("thread" in found || !isParentNotifications(found.parentNotifications)) return;
        store(threadId, found.parentNotifications);
      },
      () => {},
    );
}

/** Sets bb's setting for a thread and, once bb has taken it, shows it. Rejects when bb refuses. */
export async function setParentNotifications(sdk: PluginBrowserBbSdk, threadId: string, value: ParentNotifications): Promise<void> {
  const stretch = epoch;
  const version = nextVersion(threadId);
  const updated = await sdk.threads.update({ threadId, parentNotifications: value });
  if (stretch !== epoch || versions.get(threadId) !== version) return;
  store(threadId, isParentNotifications(updated.parentNotifications) ? updated.parentNotifications : value);
}

/**
 * bb's `parentNotifications` for `threadIds`, the threads whose menus offer
 * Notify parent. Forgotten once no menu data is mounted.
 */
export function useParentNotifications(sdk: PluginBrowserBbSdk, threadIds: readonly string[]): ReadonlyMap<string, ParentNotifications> {
  useEffect(() => {
    users += 1;
    return () => {
      users -= 1;
      if (users > 0) return;
      epoch += 1;
      values = new Map();
      requested = new Set();
      versions.clear();
    };
  }, []);
  const key = threadIds.join("\n");
  useEffect(() => {
    const next = new Set(threadIds);
    for (const threadId of next) if (!requested.has(threadId)) read(sdk, threadId);
    requested = next;
    // `key` stands for `threadIds`, whose identity moves with every sidebar update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, key]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => values,
  );
}
