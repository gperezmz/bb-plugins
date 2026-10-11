// A fake plugin server for the list's tests: `sync` and the lifecycle calls
// over the rows it holds, and realtime signals to the windows attached to it.
// It applies the rules the real server does only as far as the list's tests
// look: a call writes the row the shared constructors build and publishes it.
import { EMPTY_RECLAIM } from "@/shared/reclaim-note";
import { activeRow, parkedRow, settledRow, snoozedRow, sameRow, type LifecycleRow } from "@/shared/lifecycle";
import { DEFAULT_SETTINGS, type Settings } from "@/shared/settings";
import { CHANNELS, type Appearance, type Versioned } from "@/shared/signals";
import { attachedListStores } from "../store/list-store";
import { endPluginLifetime } from "../sync/lifetime";

/** A window the fake server publishes to: a rendered slot. */
interface FakeWindow {
  emitRealtime(channel: string, payload: unknown): Promise<void>;
}

export interface FakeServerOptions {
  settings?: Partial<Settings>;
  /** Lifecycle rows held at the start, by thread id. */
  rows?: Record<string, LifecycleRow>;
  /** Manual order, top first. */
  order?: string[];
  /** Methods that refuse, with the text they refuse with. */
  refuse?: Record<string, string>;
  /** The reclaim note the lifecycle calls answer with. */
  note?: string | null;
  /** Holds `sync` unanswered until `releaseSync`. */
  holdSync?: boolean;
}

type Change = { threadId: string; before: LifecycleRow | null; after: LifecycleRow | null; unpinned: boolean };

/**
 * Created while no list is mounted, a fake server starts a new plugin
 * lifetime in this test's window, as a reload of the app would, so nothing
 * held from an earlier test carries over; created beside a mounted list, it
 * is another window's server and leaves the lifetime alone.
 */
export function createFakeServer(options: FakeServerOptions = {}) {
  if (attachedListStores().length === 0) endPluginLifetime();
  const epoch = `fake-${(fakeServers += 1)}`;
  let revision = 0;
  const changed = new Map<string, number>();
  const rows = new Map<string, LifecycleRow>(Object.entries(options.rows ?? {}));
  const windows = new Set<FakeWindow>();
  let settings: Versioned<Settings> = { epoch, version: 1, value: { ...DEFAULT_SETTINGS, ...options.settings } };
  let order: Versioned<string[]> = { epoch, version: 1, value: options.order ?? [] };
  const appearance: Versioned<Appearance> = { epoch, version: 1, value: { colours: {}, icons: {} } };
  let holding = options.holdSync ?? false;
  let held: (() => void)[] = [];

  const publish = async (channel: string, payload: unknown) => {
    server.signals.push({ channel, payload });
    for (const window of [...windows]) await window.emitRealtime(channel, payload);
  };
  const publishRows = async (threadIds: readonly string[]) => {
    if (threadIds.length === 0) return;
    revision += 1;
    for (const threadId of threadIds) changed.set(threadId, revision);
    await publish(CHANNELS.records, {
      epoch,
      revision,
      records: Object.fromEntries(threadIds.map((threadId) => [threadId, { lifecycle: rows.get(threadId) ?? null }])),
    });
  };
  const write = (threadId: string, after: LifecycleRow | null): Change => {
    const before = rows.get(threadId) ?? null;
    if (after === null) rows.delete(threadId);
    else rows.set(threadId, after);
    return { threadId, before, after, unpinned: false };
  };
  const refusing = (method: string) => {
    const text = options.refuse?.[method];
    if (text !== undefined) throw new Error(text);
  };
  const action = async (method: string, threadId: string, after: LifecycleRow | null) => {
    server.calls.push({ method, input: { threadId } });
    refusing(method);
    const change = write(threadId, after);
    await publishRows([threadId]);
    return { changes: [change], reclaim: EMPTY_RECLAIM, note: options.note ?? null };
  };

  const server = {
    /** Every call the windows made, by method, in order. */
    calls: [] as { method: string; input: unknown }[],
    /** Every realtime signal published, by channel. */
    signals: [] as { channel: string; payload: unknown }[],
    handlers: {
      async sync({ since }: { since: { epoch: string; revision: number } | null }) {
        server.calls.push({ method: "sync", input: { since } });
        if (holding) await new Promise<void>((resolve) => held.push(resolve));
        const full = since === null || since.epoch !== epoch;
        const ids = full ? [...rows.keys()] : [...changed].flatMap(([threadId, at]) => (at > since.revision ? [threadId] : []));
        return {
          epoch,
          revision,
          full,
          settings,
          order,
          appearance,
          records: Object.fromEntries(ids.map((threadId) => [threadId, { lifecycle: rows.get(threadId) ?? null }])),
        };
      },
      snooze: async ({ threadId, until }: { threadId: string; until: number }) => {
        server.calls.push({ method: "snooze", input: { threadId, until } });
        refusing("snooze");
        const change = write(threadId, snoozedRow(until, Date.now()));
        await publishRows([threadId]);
        return { changes: [change], reclaim: EMPTY_RECLAIM, note: options.note ?? null };
      },
      wake: ({ threadId }: { threadId: string }) => action("wake", threadId, null),
      park: ({ threadId }: { threadId: string }) => action("park", threadId, parkedRow(Date.now())),
      resume: ({ threadId }: { threadId: string }) => action("resume", threadId, activeRow()),
      unsettle: ({ threadId }: { threadId: string }) => action("unsettle", threadId, activeRow()),
      async settle({ threadId }: { threadId: string }) {
        const answer = await action("settle", threadId, settledRow(Date.now(), "manual"));
        return { ...answer, undoToken: `undo-${threadId}`, undoUntil: Date.now() + 10_000 };
      },
      async undoSettle({ threadId, undoToken }: { threadId: string; undoToken: string }) {
        server.calls.push({ method: "undoSettle", input: { threadId, undoToken } });
        refusing("undoSettle");
        const change = write(threadId, null);
        await publishRows([threadId]);
        return { changes: [change], reclaim: EMPTY_RECLAIM, note: null };
      },
      async undoLifecycle({ changes }: { changes: Change[] }) {
        server.calls.push({ method: "undoLifecycle", input: { changes } });
        refusing("undoLifecycle");
        const skipped: { threadId: string; reason: string }[] = [];
        for (const change of changes) {
          if (!sameRow(rows.get(change.threadId), change.after)) {
            skipped.push({ threadId: change.threadId, reason: "Changed since" });
            continue;
          }
          write(change.threadId, change.before);
        }
        await publishRows(changes.map((change) => change.threadId));
        return { changes, skipped };
      },
      dismissWoke: ({ threadId }: { threadId: string }) => action("dismissWoke", threadId, null),
      clearPinned: ({ threadId }: { threadId: string }) => action("clearPinned", threadId, null),
      runAutoSettle: async () => {
        refusing("runAutoSettle");
        server.calls.push({ method: "runAutoSettle", input: {} });
        return { settled: [] as string[], unsettled: [] as string[] };
      },
      async reorder({ threadIds }: { threadIds: string[] }) {
        server.calls.push({ method: "reorder", input: { threadIds } });
        refusing("reorder");
        const listed = new Set(order.value);
        const base = [...threadIds.filter((id) => !listed.has(id)), ...order.value];
        const members = new Set(threadIds);
        let next = 0;
        order = { epoch, version: order.version + 1, value: base.map((id) => (members.has(id) ? threadIds[next++]! : id)) };
        await publish(CHANNELS.order, order);
        return order;
      },
    },
    /** This server's epoch, which a `records` signal names. */
    epoch,
    /** The rows the server holds. */
    get rows(): ReadonlyMap<string, LifecycleRow> {
      return rows;
    },
    get order(): readonly string[] {
      return order.value;
    },
    /** Publishes to `window` from now on; returns it. */
    attach<W extends FakeWindow>(window: W): W {
      windows.add(window);
      return window;
    },
    detach(window: FakeWindow): void {
      windows.delete(window);
    },
    /** Sets a thread's row, or clears it with null, as another window or the timer does, and publishes it. */
    async setRow(threadId: string, row: LifecycleRow | null): Promise<void> {
      write(threadId, row);
      await publishRows([threadId]);
    },
    /** Changes settings and publishes them, as the settings page does. */
    async setSettings(patch: Partial<Settings>): Promise<void> {
      settings = { epoch, version: settings.version + 1, value: { ...settings.value, ...patch } };
      await publish(CHANNELS.settings, settings);
    },
    /** Replaces the manual order and publishes it. */
    async setOrder(next: string[]): Promise<void> {
      order = { epoch, version: order.version + 1, value: next };
      await publish(CHANNELS.order, order);
    },
    /** Answers every held `sync`, and stops holding. */
    releaseSync(): void {
      holding = false;
      const waiting = held;
      held = [];
      for (const resolve of waiting) resolve();
    },
    /** Makes a method refuse from now on (null to stop). */
    refuse(method: string, text: string | null): void {
      const refuse = (options.refuse ??= {});
      if (text === null) delete refuse[method];
      else refuse[method] = text;
    },
  };
  return server;
}
export type FakeServer = ReturnType<typeof createFakeServer>;

let fakeServers = 0;
