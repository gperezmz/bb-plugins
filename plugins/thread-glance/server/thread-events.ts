// What the server does when bb announces a thread event. Events carry hidden
// threads too (bb's emitter does not filter on visibility), so these handlers
// see every thread. Each handler is idempotent: a live event may overlap the
// startup reconcile.
import { insertAtTop } from "../shared/manual-order";
import type { ArchivedThreads } from "./archived";
import type { ChangeRecords } from "./actions";
import type { LifecycleStore } from "./lifecycle-store";
import type { OrderStore } from "./order-store";
import { clearStaleRows } from "./reconcile";
import type { ThreadGateway } from "./threads";

/** The part of bb's thread payload the handlers read. */
export interface EventThread {
  id: string;
  parentThreadId: string | null;
  visibility: "hidden" | "visible";
  latestAttentionAt: number;
}

const MAX_ANCESTOR_DEPTH = 100;

export interface ThreadEventDeps {
  lifecycle: LifecycleStore;
  order: OrderStore;
  /** Publishes the manual order after the handler changed it. */
  orderChanged(): void;
  archived: ArchivedThreads;
  threads: ThreadGateway;
  change: ChangeRecords;
}

export interface ThreadEvents {
  created(thread: EventThread): Promise<void>;
  /** A thread started a turn. */
  active(thread: EventThread): Promise<void>;
  /** A thread finished, failed or asked for the user: attention may have moved. */
  attention(thread: EventThread): Promise<void>;
  archived(thread: EventThread): Promise<void>;
  unarchived(thread: EventThread): Promise<void>;
  deleted(thread: EventThread): Promise<void>;
}

export function createThreadEvents(deps: ThreadEventDeps): ThreadEvents {
  const { lifecycle, order, threads } = deps;

  const addToOrder = (thread: EventThread) => {
    if (thread.visibility === "hidden") return;
    const next = insertAtTop(order.get(), [thread.id]);
    if (next.length === order.get().length) return;
    order.replace(next);
    deps.orderChanged();
  };
  const removeFromOrder = (threadId: string) => {
    if (!order.get().includes(threadId)) return;
    order.replace(order.get().filter((id) => id !== threadId));
    deps.orderChanged();
  };

  /** Clears the parked, snoozed or settled mark of each ancestor of the thread whose parent is `parentId`. */
  async function reopenAncestors(parentId: string | null): Promise<string[]> {
    const marked = [...lifecycle.all().values()].some(
      (row) => row.parkedAt !== null || row.snoozeUntil !== null || row.settledAt !== null,
    );
    if (!marked) return [];
    const reopen: [string, null][] = [];
    const seen = new Set<string>();
    for (let id = parentId; id !== null && id !== undefined && !seen.has(id) && seen.size < MAX_ANCESTOR_DEPTH; ) {
      seen.add(id);
      const row = lifecycle.get(id);
      if (row !== null && (row.parkedAt !== null || row.snoozeUntil !== null || row.settledAt !== null)) {
        reopen.push([id, null]);
      }
      id = await threads.parentOf(id).catch(() => undefined) ?? null;
    }
    return lifecycle.putMany(reopen);
  }

  return {
    created: (thread) =>
      deps.change(async (changed) => {
        addToOrder(thread);
        changed(await reopenAncestors(thread.parentThreadId));
      }),

    active: (thread) =>
      deps.change(async (changed) => {
        const row = lifecycle.get(thread.id);
        // The active override lasts until the thread next starts a turn.
        if (row?.activeOverride) changed(lifecycle.putMany([[thread.id, { ...row, activeOverride: false }]]));
        changed(clearStaleRows(lifecycle, new Map([[thread.id, thread]])));
        changed(await reopenAncestors(thread.parentThreadId));
      }),

    attention: (thread) =>
      deps.change(async (changed) => {
        changed(clearStaleRows(lifecycle, new Map([[thread.id, thread]])));
      }),

    archived: (thread) =>
      deps.change(async () => {
        deps.archived.archive(thread.id);
        removeFromOrder(thread.id);
      }),

    unarchived: (thread) =>
      deps.change(async () => {
        deps.archived.unarchive(thread.id);
        addToOrder(thread);
      }),

    deleted: (thread) =>
      deps.change(async (changed) => {
        deps.archived.unarchive(thread.id);
        removeFromOrder(thread.id);
        changed(lifecycle.forget([thread.id]));
      }),
  };
}
