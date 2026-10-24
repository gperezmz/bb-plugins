// What the server does when bb announces a thread event. Events carry hidden
// threads too (bb's emitter does not filter on visibility), so these handlers
// see every thread. Each handler is idempotent: a live event may overlap the
// startup reconcile.
import { insertAtTop } from "../shared/manual-order";
import type { ArchivedThreads } from "./archived";
import type { ChangeRecords } from "./actions";
import type { LifecycleStore } from "./lifecycle-store";
import type { OrderStore } from "./order-store";
import { clearStaleRows, holdRows } from "./reconcile";
import type { ThreadGateway } from "./threads";
import { hasMark, heldIds, type LifecycleRow } from "../shared/lifecycle";

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

  /** The ids above the thread whose parent is `parentId`, nearest first, as far as bb knows the parents. */
  async function ancestorsFrom(parentId: string | null): Promise<string[]> {
    const found: string[] = [];
    const seen = new Set<string>();
    for (let id = parentId; id !== null && id !== undefined && !seen.has(id) && seen.size < MAX_ANCESTOR_DEPTH; ) {
      seen.add(id);
      found.push(id);
      id = (await threads.parentOf(id).catch(() => undefined)) ?? null;
    }
    return found;
  }

  /**
   * Sets aside the attention the marked threads among `ids` have while a
   * question waits below them, and returns those threads, which a turn in
   * their tree must not reopen. `thread` is the thread the event is about, with
   * the attention it carries.
   */
  async function holdWhileAsked(ids: readonly string[], thread: EventThread, changed: (threadIds: Iterable<string>) => void): Promise<Set<string>> {
    const marked = new Map(ids.flatMap((id): [string, LifecycleRow][] => (hasMark(lifecycle.get(id)) ? [[id, lifecycle.get(id)!]] : [])));
    if (marked.size === 0) return new Set();
    const visible = (await threads.snapshot())
      .filter((listed) => !listed.hidden)
      .map((listed) => (listed.id === thread.id ? { ...listed, latestAttentionAt: Math.max(listed.latestAttentionAt, thread.latestAttentionAt) } : listed));
    changed(lifecycle.putMany(holdRows(marked, visible)));
    return heldIds(marked, visible);
  }

  /** Clears the parked, snoozed or settled mark of each of `ancestors` that carries one and is not held. */
  function reopen(ancestors: readonly string[], held: ReadonlySet<string>): string[] {
    return lifecycle.putMany(ancestors.filter((id) => hasMark(lifecycle.get(id)) && !held.has(id)).map((id): [string, null] => [id, null]));
  }

  return {
    created: (thread) =>
      deps.change(async (changed) => {
        addToOrder(thread);
        if (![...lifecycle.all().values()].some(hasMark)) return;
        const ancestors = await ancestorsFrom(thread.parentThreadId);
        changed(reopen(ancestors, await holdWhileAsked(ancestors, thread, changed)));
      }),

    active: (thread) =>
      deps.change(async (changed) => {
        const row = lifecycle.get(thread.id);
        // The active override lasts until the thread next starts a turn.
        if (row?.activeOverride) changed(lifecycle.putMany([[thread.id, { ...row, activeOverride: false }]]));
        const ancestors = [...lifecycle.all().values()].some(hasMark) ? await ancestorsFrom(thread.parentThreadId) : [];
        const held = await holdWhileAsked([thread.id, ...ancestors], thread, changed);
        changed(clearStaleRows(lifecycle, new Map([[thread.id, thread]])));
        changed(reopen(ancestors, held));
      }),

    attention: (thread) =>
      deps.change(async (changed) => {
        await holdWhileAsked([thread.id], thread, changed);
        changed(clearStaleRows(lifecycle, new Map([[thread.id, thread]])));
      }),

    archived: (thread) =>
      deps.change(async () => {
        deps.archived.archive(thread.id);
        removeFromOrder(thread.id);
      }),

    unarchived: (thread) =>
      deps.change(async (changed) => {
        deps.archived.unarchive(thread.id);
        addToOrder(thread);
        // A full `sync` left its record out while it was archived.
        if (lifecycle.get(thread.id) !== null) changed([thread.id]);
      }),

    deleted: (thread) =>
      deps.change(async (changed) => {
        deps.archived.unarchive(thread.id);
        removeFromOrder(thread.id);
        changed(lifecycle.forget([thread.id]));
      }),
  };
}
