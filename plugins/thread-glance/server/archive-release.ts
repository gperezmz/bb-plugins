// When a thread is archived from any bb menu, bb force-closes its terminals but
// stops its runtime only while a turn is in flight, so an idle thread's agent
// session would stay loaded. This stops the runtime of the archived thread and
// of its children that are not busy, and leaves a working child alone.
import { isBusy } from "../shared/busy";
import type { ThreadRuntime } from "./runtime";
import type { ThreadGateway } from "./threads";

export interface ArchiveReleaseDeps {
  threads: Pick<ThreadGateway, "snapshot">;
  runtime: ThreadRuntime;
  warn?: (message: string) => void;
}

/** Releases the runtimes of an archived thread and its idle children. It never rejects: a failure releases less. */
export type ArchiveRelease = (archivedThreadId: string) => Promise<void>;

export function createArchiveRelease(deps: ArchiveReleaseDeps): ArchiveRelease {
  const warn = deps.warn ?? (() => undefined);

  const stop = async (threadId: string) => {
    try {
      await deps.runtime.stop(threadId);
    } catch (error) {
      warn(`could not stop the runtime of ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return async (archivedThreadId) => {
    let idleChildren: string[] = [];
    try {
      idleChildren = (await deps.threads.snapshot())
        .filter((thread) => thread.parentThreadId === archivedThreadId && !isBusy(thread))
        .map((thread) => thread.id);
    } catch (error) {
      warn(`could not list the children of ${archivedThreadId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await Promise.all([archivedThreadId, ...idleChildren].map(stop));
  };
}
