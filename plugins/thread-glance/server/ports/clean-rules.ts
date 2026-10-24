// Which settled threads Clean may touch. Pure.
import { isBusy } from "../../shared/busy";
import { shelfOf, type LifecycleRow } from "../../shared/lifecycle";
import type { ServerThread } from "../threads";
import type { EnvironmentLocation } from "./environments";

/**
 * Whether the thread passes Clean's test: on the Settled shelf by the shared
 * shelf rule (so unpinned, not busy and without attention since it settled),
 * and not hidden. Callers pass the non-archived threads, and whether a
 * question waits below the thread, which lifts it off Settled.
 */
export function isCleanable(thread: ServerThread, row: LifecycleRow | null, now: number, lifted = false): boolean {
  if (thread.hidden || thread.archived || isBusy(thread)) return false;
  return shelfOf(row, thread, { now, workingShelf: false, inactiveShelf: false, hoursBeforeInactive: 1, lifted }) === "settled";
}

/** A workspace as threads compare it: the machine and the path without a trailing slash. */
function workspaceKey(location: EnvironmentLocation): string {
  return `${location.hostId}\0${location.path.replace(/\/+$/, "")}`;
}

/**
 * The threads of `candidates` Clean leaves out because they share a workspace
 * (the same environment, or the same machine and path in another environment)
 * with a non-archived thread that fails the test, or because their workspace
 * cannot be resolved. `failing` holds the ids of non-archived threads that
 * fail `isCleanable`, hidden ones included.
 */
export function omitSharedWorkspaces(input: {
  candidates: readonly ServerThread[];
  allThreads: readonly ServerThread[];
  failing: ReadonlySet<string>;
  locations: ReadonlyMap<string, EnvironmentLocation>;
}): ServerThread[] {
  const blockedEnvironments = new Set<string>();
  const blockedWorkspaces = new Set<string>();
  for (const thread of input.allThreads) {
    if (!input.failing.has(thread.id) || thread.environmentId === null) continue;
    blockedEnvironments.add(thread.environmentId);
    const location = input.locations.get(thread.environmentId);
    if (location !== undefined) blockedWorkspaces.add(workspaceKey(location));
  }
  return input.candidates.filter((thread) => {
    if (thread.environmentId === null) return false;
    const location = input.locations.get(thread.environmentId);
    if (location === undefined) return false;
    return !blockedEnvironments.has(thread.environmentId) && !blockedWorkspaces.has(workspaceKey(location));
  });
}
