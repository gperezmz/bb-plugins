// Scheduled sends: queued rows whose `sendAt` is in the future, kept in
// memory and seeded again on every server start.
import type { ScheduledSignal } from "../shared/contract";

/** The fields of a queued row the tracker reads. */
export interface QueuedRow {
  id: string;
  threadId: string;
  sendAt: number | null;
}

type Change =
  | { type: "upsert"; row: QueuedRow }
  | { type: "remove"; rowId: string }
  | { type: "remove-thread"; threadId: string };

export interface ScheduledTracker {
  /** `message.queued`: keeps the row while its `sendAt` is in the future. */
  queued(row: QueuedRow): void;
  /** `message.dispatched` and `message.cancelled`. */
  removed(rowId: string): void;
  /** `thread.archived` and `thread.deleted`. */
  threadGone(threadId: string): void;
  /**
   * Replaces the rows with `load`'s result. Changes that arrive while `load`
   * runs are applied on top, so they are not lost. A failed load sets the
   * status to `error` and keeps the rows it had. Returns whether it loaded.
   */
  seed(load: () => Promise<readonly QueuedRow[]>): Promise<boolean>;
  /** The current map; waits for a seed that is running. */
  snapshot(): Promise<ScheduledSignal>;
}

/**
 * Creates a tracker that calls `publish` whenever the per-thread map or the
 * status changes. The status is `error` until the first seed succeeds.
 */
export function createScheduledTracker(options: {
  publish: (signal: ScheduledSignal) => void;
  now?: () => number;
}): ScheduledTracker {
  const now = options.now ?? Date.now;
  let rows = new Map<string, { threadId: string; sendAt: number }>();
  let status: ScheduledSignal["status"] = "error";
  let duringSeed: Change[] | null = null;
  let seeding: Promise<boolean> | null = null;
  let lastPublished = JSON.stringify({ status, scheduled: {} } satisfies ScheduledSignal);

  function apply(change: Change): void {
    switch (change.type) {
      case "upsert": {
        const { id, threadId, sendAt } = change.row;
        if (sendAt !== null && sendAt > now()) rows.set(id, { threadId, sendAt });
        else rows.delete(id);
        break;
      }
      case "remove":
        rows.delete(change.rowId);
        break;
      case "remove-thread":
        for (const [id, row] of rows) if (row.threadId === change.threadId) rows.delete(id);
        break;
    }
  }

  function current(): ScheduledSignal {
    const at = now();
    const scheduled: Record<string, number> = {};
    for (const [id, row] of rows) {
      if (row.sendAt <= at) {
        rows.delete(id);
        continue;
      }
      const earliest = scheduled[row.threadId];
      if (earliest === undefined || row.sendAt < earliest) scheduled[row.threadId] = row.sendAt;
    }
    return { status, scheduled };
  }

  function publishIfChanged(): void {
    const signal = current();
    const serialized = JSON.stringify(signal);
    if (serialized === lastPublished) return;
    lastPublished = serialized;
    options.publish(signal);
  }

  function change(next: Change): void {
    duringSeed?.push(next);
    apply(next);
    publishIfChanged();
  }

  async function runSeed(load: () => Promise<readonly QueuedRow[]>): Promise<boolean> {
    duringSeed = [];
    try {
      const loaded = await load();
      const pending = duringSeed;
      rows = new Map();
      for (const row of loaded) apply({ type: "upsert", row });
      for (const later of pending) apply(later);
      status = "ready";
      return true;
    } catch {
      status = "error";
      return false;
    } finally {
      duringSeed = null;
      publishIfChanged();
    }
  }

  return {
    queued: (row) => change({ type: "upsert", row }),
    removed: (rowId) => change({ type: "remove", rowId }),
    threadGone: (threadId) => change({ type: "remove-thread", threadId }),
    seed(load) {
      const run = runSeed(load).finally(() => {
        if (seeding === run) seeding = null;
      });
      seeding = run;
      return run;
    },
    async snapshot() {
      if (seeding !== null) await seeding;
      return current();
    },
  };
}
