// The list's record of when each thread was first seen working, kept on the
// device so a reload does not restart the count. The rule is in
// ../model/working-since; this keeps the stamps and writes them.
import { NO_STAMPS, observeWorking, readWorkingStamps, type WorkingStamps } from "../model/working-since";
import type { DeviceStorage } from "../storage/device-storage";

export interface WorkingSince {
  /** When the thread was first seen working in this stretch of work; null if it is not stamped. */
  get(threadId: string): number | null;
  /** Records which threads are working now. */
  observe(workingIds: Iterable<string>, now: number): void;
}

export function createWorkingSince(storage: DeviceStorage): WorkingSince {
  let stamps: WorkingStamps = readWorkingStamps(storage.read("workingSince"));
  return {
    get: (threadId) => stamps[threadId]?.since ?? null,
    observe(workingIds, now) {
      const next = observeWorking(stamps, workingIds, now);
      if (next === stamps) return;
      stamps = next;
      if (next === NO_STAMPS || Object.keys(next).length === 0) storage.remove("workingSince");
      else storage.write("workingSince", next);
    },
  };
}
