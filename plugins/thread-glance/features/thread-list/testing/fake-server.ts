// A fake plugin server for the list's tests: `sync` and the lifecycle calls
// over the rows it holds, and realtime signals to the windows attached to it.
// It applies the rules the real server does only as far as the list's tests
// look: a call writes the row the shared constructors build and publishes it.
import { SNOOZE_ENDED } from "@/shared/messages";
import { EMPTY_PORTS, type PortsSnapshot } from "@/shared/ports";
import { EMPTY_RECLAIM } from "@/shared/reclaim-note";
import { activeRow, parkedRow, settledRow, snoozedRow, sameRow, waitingSettleRow, type LifecycleRow } from "@/shared/lifecycle";
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
  /** Threads whose Settle waits, as the server answers for a busy tree. */
  settleWaits?: readonly string[];
  /** The reclaim note the lifecycle calls answer with. */
  note?: string | null;
  /** Project colour overrides and icon uploads held at the start. */
  appearance?: Partial<Appearance>;
  /** Holds `sync` unanswered until `releaseSync`. */
  holdSync?: boolean;
  /** Holds `reorder` unanswered until `releaseReorder`, which then answers as `refuse` says. */
  holdReorder?: boolean;
  /** The workspace ports snapshot held at the start. */
  ports?: Partial<Omit<PortsSnapshot, "at">>;
  /**
   * What the port and Clean calls answer, by method, instead of their defaults
   * (nothing owned, nothing to clean): a value, or a function of the input that
   * returns it or a promise of it.
   */
  answers?: Partial<Record<PortsMethod, unknown>>;
}

/** The calls of workspace ports and Clean the fake answers. */
type PortsMethod = "stopPort" | "ownedPorts" | "closePorts" | "previewClean" | "runClean";

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
  const appearance: Versioned<Appearance> = { epoch, version: 1, value: { colours: options.appearance?.colours ?? {}, icons: options.appearance?.icons ?? {} } };
  let holding = options.holdSync ?? false;
  let held: (() => void)[] = [];
  let holdingReorder = options.holdReorder ?? false;
  let heldReorders: (() => void)[] = [];
  let ports: Versioned<PortsSnapshot> = { epoch, version: 1, value: { ...EMPTY_PORTS, at: Date.now(), ...options.ports } };
  const answers: Partial<Record<PortsMethod, unknown>> = { ...options.answers };
  /** Failures injected for the next call of a method only. */
  const failures = new Map<string, string>();

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
    const once = failures.get(method);
    if (once !== undefined) {
      failures.delete(method);
      throw new Error(once);
    }
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

  /** A port or Clean call: logged, refused when asked to, and answered with what `answers` holds, else `fallback`. */
  const portsCall = (method: PortsMethod, fallback: unknown) => async (input: unknown) => {
    server.calls.push({ method, input });
    refusing(method);
    const answer = answers[method];
    if (typeof answer === "function") return (answer as (input: unknown) => unknown)(input);
    return answer ?? fallback;
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
        if (options.settleWaits?.includes(threadId)) {
          const answer = await action("settle", threadId, waitingSettleRow(Date.now()));
          return { ...answer, note: null, waiting: true };
        }
        const answer = await action("settle", threadId, settledRow(Date.now(), "manual"));
        return { ...answer, waiting: false, undoToken: `undo-${threadId}`, undoUntil: Date.now() + 10_000 };
      },
      cancelSettle: ({ threadId }: { threadId: string }) => action("cancelSettle", threadId, null),
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
          if (change.before?.snoozeUntil != null && change.before.snoozeUntil <= Date.now()) {
            skipped.push({ threadId: change.threadId, reason: SNOOZE_ENDED });
            continue;
          }
          write(change.threadId, change.before);
        }
        await publishRows(changes.map((change) => change.threadId));
        return { changes, skipped };
      },
      dismissWoke: ({ threadId }: { threadId: string }) => action("dismissWoke", threadId, null),
      clearPinned: ({ threadId }: { threadId: string }) => action("clearPinned", threadId, null),
      async ports(input: { fresh: boolean }) {
        server.calls.push({ method: "ports", input });
        refusing("ports");
        return ports;
      },
      stopPort: portsCall("stopPort", { outcome: "requested" }),
      ownedPorts: portsCall("ownedPorts", { ports: [] }),
      closePorts: portsCall("closePorts", { outcome: "requested" }),
      previewClean: portsCall("previewClean", { token: "clean-1", expiresAt: Date.now() + 120_000, threads: [] }),
      runClean: portsCall("runClean", { expired: false, closedTerminals: 0, portRequests: 0, stillListening: [], issues: [] }),
      runAutoSettle: async () => {
        refusing("runAutoSettle");
        server.calls.push({ method: "runAutoSettle", input: {} });
        return { settled: [] as string[], unsettled: [] as string[] };
      },
      async writeSettings({ patch }: { patch: Partial<Settings> }) {
        server.calls.push({ method: "writeSettings", input: { patch } });
        refusing("writeSettings");
        settings = { epoch, version: settings.version + 1, value: { ...settings.value, ...patch } };
        await publish(CHANNELS.settings, settings);
        return settings;
      },
      async reorder({ threadIds }: { threadIds: string[] }) {
        server.calls.push({ method: "reorder", input: { threadIds } });
        if (holdingReorder) await new Promise<void>((resolve) => heldReorders.push(resolve));
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
    /** Replaces the ports snapshot (what `patch` gives, over an empty one) and publishes it, as the server's refresh does. */
    async setPorts(patch: Partial<Omit<PortsSnapshot, "at">>): Promise<void> {
      ports = { epoch, version: ports.version + 1, value: { ...EMPTY_PORTS, at: Date.now(), ...patch } };
      await publish(CHANNELS.ports, ports);
    },
    /** What the port and Clean calls answer from now on. */
    answer(method: PortsMethod, value: unknown): void {
      answers[method] = value;
    },
    /** Makes the next call of `method` fail with `text`. */
    failOnce(method: string, text: string): void {
      failures.set(method, text);
    },
    /** Answers every held `sync`, and stops holding. */
    releaseSync(): void {
      holding = false;
      const waiting = held;
      held = [];
      for (const resolve of waiting) resolve();
    },
    /** Answers every held `reorder`, and stops holding. */
    releaseReorder(): void {
      holdingReorder = false;
      const waiting = heldReorders;
      heldReorders = [];
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
