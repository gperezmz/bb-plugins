// The list store: everything the sidebar list is built from, the list model
// its derive step builds, and the list's own state, outside React. Rows read
// their own part of the model by thread id, so an event renders only what it
// changed. bb's data and the plugin server's signals are applied once per
// animation frame, so a turn's burst of them renders once; everything else,
// and whatever a person does, is applied at once. What the plugin server
// answered comes from the plugin's data (../sync), which outlives the store,
// so a list mounted again starts from it.
import type { BbNavigate, PluginBrowserBbSdk, PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { pluginData, type DataChange } from "../sync";
import type { ListModel } from "../model/list-model";
import { resolveScope } from "../model/scope";
import {
  readDeviceState,
  saveDeviceState,
  type DeviceState,
} from "../storage/device-state";
import { createDeviceStorage, type DeviceStorage } from "../storage/device-storage";
import { isWorking } from "@/shared/busy";
import { startClock, type Clock } from "./clock";
import { derive, FIRST_SETTLED_SHOWN, NO_HOST, type HostData, type ListInputs } from "./derive";
import { createStore, type StoreApi } from "./vanilla";
import { createWorkingSince, type WorkingSince } from "./working-since";

/** The list's own state: what it shows open, renamed or dragged. */
export interface ListUi {
  /** The thread whose title is being renamed. */
  editingId: string | null;
  /** The row or group being dragged, as `listKey/unitKey`; null when no drag runs. */
  dragging: { listKey: string; unitKey: string } | null;
  /** The text of the list's live region: reorder announcements. */
  announcement: string;
}

export interface ListState {
  inputs: ListInputs;
  /** Null until bb's threads and the server's rows are there. */
  model: ListModel | null;
  ui: ListUi;
}

/** bb's and the plugin server's calls, kept behind one reference: commands read them when they run. */
export interface Edge {
  navigate: BbNavigate;
  sdk: PluginBrowserBbSdk;
  rpc: PluginRpcClient<RpcContract>;
  /** Closes bb's mobile drawer after a thread is opened. */
  onNavigate(): void;
}

export interface ListStore extends StoreApi<ListState> {
  edge: Edge;
  storage: DeviceStorage;
  /** When each working thread was first seen working, for the Status slot's elapsed time. */
  workingSince: WorkingSince;
  /** bb's list data, applied on the next animation frame. */
  feedHost(host: HostData): void;
  /** The focused thread and the viewport, applied at once. */
  feedFocus(activeThreadId: string | null, compact: boolean): void;
  /** A plugin server signal's change, applied with bb's data on the next animation frame. */
  feedSignal(change: (inputs: ListInputs) => Partial<Omit<ListInputs, "host">>): void;
  /** Any other input, applied at once. */
  feed(change: Partial<Omit<ListInputs, "host">> | ((inputs: ListInputs) => Partial<Omit<ListInputs, "host">>)): void;
  setUi(change: Partial<ListUi> | ((ui: ListUi) => Partial<ListUi>)): void;
  /** Changes the device's state and writes what changed to the browser's storage. */
  updateDevice(change: (device: DeviceState) => DeviceState): void;
  /** Applies bb data still waiting for its frame. */
  flush(): void;
  /**
   * Starts the clock, follows the plugin's data and sends what waited for the
   * list to mount; returns the call that stops them.
   */
  attach(): () => void;
}

const unset = (): never => {
  throw new Error("the list store's edge is not set yet");
};

const UNSET_EDGE: Edge = {
  get navigate(): never {
    return unset();
  },
  get sdk(): never {
    return unset();
  },
  get rpc(): never {
    return unset();
  },
  onNavigate() {},
};

const CLOSED_UI: ListUi = { editingId: null, dragging: null, announcement: "" };

const NO_ORDER: readonly string[] = [];

/** What the list draws: bb's error, a loading state while anything it needs is on its way, or the list. */
export function listStatusOf(state: ListState): "error" | "loading" | "ready" {
  if (state.inputs.host.status === "error") return "error";
  return state.model === null ? "loading" : "ready";
}

/** Stores with a mounted list, for tests to flush. */
const attached = new Set<ListStore>();

/** Applies every attached list's waiting bb data now, as a test does before it looks. */
export function flushListStores(): void {
  for (const store of attached) store.flush();
}

/** The attached stores, newest last. */
export function attachedListStores(): readonly ListStore[] {
  return [...attached];
}

function sameHost(a: HostData, b: HostData): boolean {
  return (Object.keys(a) as (keyof HostData)[]).every((key) => a[key] === b[key]);
}

const frames = {
  request: (run: () => void): number =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number),
  cancel: (id: number) =>
    typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

/** The inputs the plugin's data gives, as it stands. */
function dataInputs(): Pick<ListInputs, "lifecycle" | "rowsReady" | "settings" | "order"> {
  const data = pluginData.get();
  return {
    lifecycle: data.records.lifecycle,
    // An answer, a cache of earlier answers, or a failed answer: any of them is a list to draw.
    rowsReady: data.records.point !== null || data.cached || data.status === "failed",
    settings: pluginData.settings(),
    order: data.order?.value ?? NO_ORDER,
  };
}

export interface ListStoreOptions {
  storage?: DeviceStorage;
}

export function createListStore(options: ListStoreOptions = {}): ListStore {
  const storage = options.storage ?? createDeviceStorage();
  pluginData.hydrate(storage);
  const inputs: ListInputs = {
    host: NO_HOST,
    activeThreadId: null,
    compact: false,
    ...dataInputs(),
    pendingOrder: null,
    pinnedOverride: null,
    device: readDeviceState(storage),
    scopeId: null,
    now: Date.now(),
    settledShown: FIRST_SETTLED_SHOWN,
    frozenShelves: new Map(),
    drag: null,
  };
  const workingSince = createWorkingSince(storage);
  const api = createStore<ListState>({ inputs, model: null, ui: CLOSED_UI });
  /** bb's latest data, applied or waiting for its frame. */
  let host: HostData = NO_HOST;
  let frame: number | null = null;
  // Signals waiting for the frame, in the order they came.
  let signals: ((inputs: ListInputs) => Partial<Omit<ListInputs, "host">>)[] = [];
  let clock: Clock | null = null;
  let mounted = false;
  // Requests the derive step asked for before the list mounted.
  let waiting: (() => void)[] = [];
  // Woke threads this window has asked the server to clear because they are open.
  const wokeClearAsked = new Set<string>();
  // Pinned threads whose lifecycle row this window has asked the server to clear.
  const pinClearAsked = new Set<string>();

  const whenMounted = (request: () => void) => {
    if (mounted) request();
    else waiting.push(request);
  };

  /** Runs the derive step over `next` and publishes the result. */
  const commit = (next: ListInputs) => {
    // A project scope whose project is gone is All projects again.
    const scopeId = resolveScope(next.scopeId, next.host.projects);
    const checked = scopeId === next.scopeId ? next : { ...next, scopeId };
    const current = api.getState();
    const model = derive(checked, current.model);
    // A thread deleted or archived mid-drag ends the drag.
    const { dragging } = current.ui;
    if (dragging !== null && model !== null && checked.drag !== null) {
      const present = model.reorderLists.get(dragging.listKey)?.units.some((unit) => unit.key === dragging.unitKey) ?? false;
      if (!present) {
        api.setState({ ui: { ...current.ui, dragging: null } });
        commit({ ...checked, drag: null });
        return;
      }
    }
    const deadline = current.model?.nextDeadline ?? null;
    // Stamped before the rows are told, so a row that renders for its thread working reads the stamp.
    if (model !== null) {
      const workingIds: string[] = [];
      for (const row of model.rows.values()) if (isWorking(row.thread)) workingIds.push(row.id);
      workingSince.observe(workingIds, Date.now());
    }
    api.setState({ inputs: checked, model });
    if (model !== null) {
      for (const threadId of model.pinnedWithRow) {
        if (pinClearAsked.has(threadId)) continue;
        pinClearAsked.add(threadId);
        whenMounted(() => void store.edge.rpc.call("clearPinned", { threadId }).catch(() => undefined));
      }
      for (const threadId of [...pinClearAsked]) if (!model.pinnedWithRow.includes(threadId)) pinClearAsked.delete(threadId);
      // Opening a woke thread clears its Woke marker.
      const open = checked.activeThreadId === null ? undefined : model.rows.get(checked.activeThreadId);
      if (open?.woke != null && !wokeClearAsked.has(open.id)) {
        wokeClearAsked.add(open.id);
        whenMounted(() => void store.edge.rpc.call("dismissWoke", { threadId: open.id }).catch(() => undefined));
      }
      for (const threadId of [...wokeClearAsked]) if (model.rows.get(threadId)?.woke == null) wokeClearAsked.delete(threadId);
    }
    if ((model?.nextDeadline ?? null) !== deadline) clock?.reschedule();
  };

  /** Applies bb's latest data and the signals waiting with it, as one step. */
  const applyFrame = () => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    const waitingSignals = signals;
    signals = [];
    const current = api.getState().inputs;
    let next = current.host === host ? current : { ...current, host };
    for (const change of waitingSignals) next = { ...next, ...change(next) };
    if (next === current) return;
    commit(next);
  };
  const requestFrame = () => {
    if (frame === null) frame = frames.request(applyFrame);
  };

  /** Applies a change of the plugin's data: signals with the next frame, answers at once. */
  const onData = (change: DataChange) => {
    switch (change.kind) {
      case "synced":
      case "failed":
      case "settings":
        store.feed(dataInputs);
        return;
      case "records":
      case "order":
        store.feedSignal(dataInputs);
        return;
      case "appearance":
        return;
    }
  };

  const store: ListStore = {
    ...api,
    edge: UNSET_EDGE,
    storage,
    workingSince,

    feedHost(next) {
      if (sameHost(next, host)) return;
      const first = host === NO_HOST;
      host = next;
      // Nothing is drawn yet, so the first data is drawn at once.
      if (first) applyFrame();
      else requestFrame();
    },

    feedSignal(change) {
      signals.push(change);
      requestFrame();
    },

    feedFocus(activeThreadId, compact) {
      const current = api.getState().inputs;
      if (activeThreadId === current.activeThreadId && compact === current.compact) return;
      commit({ ...current, activeThreadId, compact });
    },

    feed(change) {
      const current = api.getState().inputs;
      const patch = typeof change === "function" ? change(current) : change;
      const keys = Object.keys(patch) as (keyof typeof patch)[];
      if (keys.every((key) => Object.is(patch[key], current[key]))) return;
      commit({ ...current, ...patch });
    },

    setUi(change) {
      const ui = api.getState().ui;
      const patch = typeof change === "function" ? change(ui) : change;
      const keys = Object.keys(patch) as (keyof ListUi)[];
      if (keys.every((key) => Object.is(patch[key], ui[key]))) return;
      api.setState({ ui: { ...ui, ...patch } });
    },

    updateDevice(change) {
      const previous = api.getState().inputs.device;
      const device = change(previous);
      if (device === previous) return;
      saveDeviceState(storage, previous, device);
      store.feed({ device });
    },

    flush: applyFrame,

    attach() {
      mounted = true;
      attached.add(store);
      const unfollow = pluginData.subscribe(onData);
      // What changed between the store's creation and its mount.
      store.feed(dataInputs);
      const requests = waiting;
      waiting = [];
      for (const request of requests) request();
      // A list mounting is a reason to run an auto-settle pass.
      void Promise.resolve()
        .then(() => store.edge.rpc.call("runAutoSettle", {}))
        .catch(() => undefined);
      clock = startClock({
        tick: () => store.feed({ now: Date.now() }),
        nextDeadline: () => api.getState().model?.nextDeadline ?? null,
      });
      return () => {
        unfollow();
        clock?.stop();
        clock = null;
        if (frame !== null) frames.cancel(frame);
        frame = null;
        attached.delete(store);
        mounted = false;
      };
    },
  };
  return store;
}
