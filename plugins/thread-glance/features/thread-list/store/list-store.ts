// The list store: everything the sidebar list is built from, the list model
// its derive step builds, and the list's own state, outside React. Rows,
// group headers and the list header each read their own part, so an event
// renders only what it changed. bb's data and the plugin server's signals
// are applied once per animation frame, so a turn's burst of them renders
// once; everything else, and whatever a person does, is applied at once.
// What the plugin server and bb's lookups answered comes from the plugin's
// data (../sync), which outlives the store, so a list mounted again starts
// from it.
import type {
  PluginBrowserBbSdk,
  PluginRpcClient,
  PluginSidebarSection,
  PluginSidebarThreadActions,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { RpcContract } from "@/shared/contract";
import {
  CLIENT_PREFERENCES_STORAGE_KEY,
  coercePreferences,
  isPreferenceKey,
  parseClientPreferences,
  PREFERENCES_MIRROR_STORAGE_KEY,
  type ClientPreferences,
  type HarnessIcon,
  type OrganizationMode,
  type PreferenceKey,
  type Preferences,
} from "@/shared/preferences";
import { trackIdle, type IdleTracker } from "../model/attention";
import { share } from "../model/share";
import { fetchMissing, pluginData, readJson, writeJson, type DataChange } from "../sync";
import { startClock, type Clock } from "./clock";
import { derive, FIRST_STEP, NO_HOST, NO_PENDING_READ, onlyReadChanged, type DeriveMemory, type HostData, type ListInputs, type ListModel } from "./derive";
import { createStore, type StoreApi } from "./vanilla";

/** A row's drop feedback while a thread is dragged over it. */
export type DropState = "valid" | "blocked" | "unchanged" | "before" | "after";

/** A confirmation the list asks for before it acts. */
export interface Confirm {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  run(): void;
}

/** The list's own state: what it shows open, renamed or dragged over. */
export interface ListUi {
  /** The thread whose title is being renamed. */
  editingId: string | null;
  detailsId: string | null;
  moveId: string | null;
  moveQuery: string;
  customizeOpen: boolean;
  newSectionOpen: boolean;
  confirm: Confirm | null;
  /** Drop feedback by thread id. */
  dropStates: ReadonlyMap<string, DropState>;
  /** The group a dragged group header would drop on. */
  dropGroupId: string | null;
}

/** How every row is drawn: one object, the same while none of it changes. */
export interface ListLayout {
  /** bb's compact viewport: a phone. */
  compact: boolean;
  density: ClientPreferences["density"];
  branchLine: boolean;
  harnessIcon: HarnessIcon;
  mode: OrganizationMode;
  /** Rows offer Move to section. */
  hasSections: boolean;
  sections: readonly PluginSidebarSection[];
}

export interface ListState {
  inputs: ListInputs;
  /** Null until bb's threads are ready. */
  model: ListModel | null;
  ui: ListUi;
  layout: ListLayout;
}

/** bb's and the plugin server's calls, kept behind one reference: commands read them when they run. */
export interface Edge {
  actions: PluginSidebarThreadActions;
  sdk: PluginBrowserBbSdk;
  rpc: PluginRpcClient<RpcContract>;
  onNavigate(): void;
  /** This list is the one in the browser that reports changes to idle bb sends no event for. */
  isIdleReporter(): boolean;
}

/**
 * The list store: a vanilla store of `ListState`, and the calls that feed it
 * and act on it (the command API), each of which runs the derive step where
 * the model's inputs change.
 */
export interface ListStore extends StoreApi<ListState> {
  edge: Edge;
  /** bb's list data, applied on the next animation frame. */
  feedHost(host: HostData): void;
  /** The focused thread and the viewport, applied at once. */
  feedFocus(activeThreadId: string | null, compact: boolean): void;
  /** A plugin server signal's change, applied with bb's data on the next animation frame. */
  feedSignal(change: (inputs: ListInputs) => Partial<Omit<ListInputs, "host">>): void;
  /** Any other input, applied at once. */
  feed(change: Partial<Omit<ListInputs, "host">> | ((inputs: ListInputs) => Partial<Omit<ListInputs, "host">>)): void;
  setUi(change: Partial<ListUi> | ((ui: ListUi) => Partial<ListUi>)): void;
  /** Applies bb data still waiting for its frame. */
  flush(): void;
  /** The server's preferences, keeping any this window has not written yet. */
  receivePreferences(preferences: unknown): void;
  /** One preference another window or the CLI changed. */
  receivePreference(key: PreferenceKey, value: unknown): void;
  /** A preference change this window made; `also` changes other inputs in the same step. */
  updatePreferences(patch: Partial<Preferences>, also?: Partial<Omit<ListInputs, "host" | "prefs">>): void;
  /** Sends every preference write not yet sent. */
  flushPreferences(): void;
  updateClient(patch: Partial<ClientPreferences>): void;
  /**
   * Shows `read` read at once, while their read requests are pending, and
   * marks `seen` seen, in one step.
   */
  showRead(read: readonly string[], seen: readonly string[]): void;
  /** Stops showing threads read whose read request failed: they show as bb has them. */
  revertRead(threadIds: readonly string[]): void;
  clearSeen(threadIds: readonly string[]): void;
  /**
   * Starts the clock, follows the plugin's data and sends what waited for the
   * list to mount; returns the call that stops them.
   */
  attach(): () => void;
}

const WRITE_DEBOUNCE_MS = 150;
/** No drop feedback. */
export const NO_DROPS: ReadonlyMap<string, DropState> = new Map();

const unset = (): never => {
  throw new Error("the list store's edge is not set yet");
};

const UNSET_EDGE: Edge = {
  get actions(): never {
    return unset();
  },
  get sdk(): never {
    return unset();
  },
  get rpc(): never {
    return unset();
  },
  onNavigate() {},
  isIdleReporter: () => false,
};

export const CLOSED_UI: ListUi = {
  editingId: null,
  detailsId: null,
  moveId: null,
  moveQuery: "",
  customizeOpen: false,
  newSectionOpen: false,
  confirm: null,
  dropStates: NO_DROPS,
  dropGroupId: null,
};

/** What the list draws: bb's error, a skeleton while anything it needs is on its way, or the list. */
export function listStatusOf(state: ListState): "error" | "loading" | "ready" {
  const { host, hydrated } = state.inputs;
  if (host.status === "error") return "error";
  return host.status === "loading" || !hydrated || state.model === null ? "loading" : "ready";
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

/** bb's data with each list that arrived equal to the last one's kept, so an equal list is no change. */
function shareHost(previous: HostData, next: HostData): HostData {
  return {
    ...next,
    projects: share(previous.projects, next.projects),
    sections: share(previous.sections, next.sections),
    providers: share(previous.providers, next.providers),
    environmentProviders: share(previous.environmentProviders, next.environmentProviders),
    draftIds: share(previous.draftIds, next.draftIds),
    splitLayout: share(previous.splitLayout, next.splitLayout),
  };
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

function layoutOf(previous: ListLayout | null, inputs: ListInputs, compact: boolean): ListLayout {
  const { prefs, client, host } = inputs;
  const next: ListLayout = {
    compact,
    density: client.density,
    branchLine: client.branchLine,
    harnessIcon: prefs.harnessIcon,
    mode: prefs.organizationMode,
    hasSections: prefs.organizationMode === "chronological" || host.sections.length > 0,
    sections: host.sections,
  };
  return previous === null ? next : share(previous, next);
}

/** The inputs the plugin's data gives, as it stands. */
function dataInputs(): Pick<ListInputs, "stamps" | "notes" | "scheduled" | "stampsLoaded" | "hydrated" | "system" | "defaultBranches"> {
  const data = pluginData.get();
  return {
    stamps: data.records.stamps,
    notes: data.records.notes,
    scheduled: data.scheduled,
    // Stamps held from an earlier answer are what the list was drawn from.
    stampsLoaded: data.records.point !== null || data.status === "failed",
    // A list mounted while realtime went unfollowed waits for what it missed.
    hydrated: data.status !== "waiting",
    system: data.system,
    defaultBranches: data.defaultBranches,
  };
}

export function createListStore(): ListStore {
  const known = pluginData.get().preferences;
  const inputs: ListInputs = {
    host: NO_HOST,
    activeThreadId: null,
    prefs: known ?? coercePreferences(readJson(PREFERENCES_MIRROR_STORAGE_KEY)),
    client: parseClientPreferences(readJson(CLIENT_PREFERENCES_STORAGE_KEY)),
    ...dataInputs(),
    now: Date.now(),
    idleSince: {},
    needYouOn: false,
    targets: new Map(),
    pendingRead: NO_PENDING_READ,
  };
  const api = createStore<ListState>({ inputs, model: null, ui: CLOSED_UI, layout: layoutOf(null, inputs, false) });
  let memory: DeriveMemory = FIRST_STEP;
  let compact = false;
  /** bb's latest data, applied or waiting for its frame. */
  let host: HostData = NO_HOST;
  let frame: number | null = null;
  // Signals waiting for the frame, in the order they came.
  let signals: ((inputs: ListInputs) => Partial<Omit<ListInputs, "host">>)[] = [];
  let tracker: IdleTracker | null = null;
  let tracked: HostData["threads"] | null = null;
  let clock: Clock | null = null;
  let mounted = false;
  // Requests the derive step or the idle tracker asked for before the list mounted.
  let waiting: (() => void)[] = [];
  // Preference writes not yet sent: a reload or an echo must not put back
  // the value one of them replaced.
  const pending = new Map<PreferenceKey, unknown>();
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const whenMounted = (request: () => void) => {
    if (mounted) request();
    else waiting.push(request);
  };

  /** Runs the derive step over `next` and publishes the result. */
  const commit = (next: ListInputs) => {
    const step = derive(next, memory, Date.now());
    memory = step.memory;
    const current = api.getState();
    const deadline = current.model?.nextDeadline ?? null;
    api.setState({ inputs: step.inputs, model: step.model, layout: layoutOf(current.layout, step.inputs, compact) });
    if (step.seen.length > 0) whenMounted(() => void store.edge.rpc.call("markSeen", { threadIds: step.seen }).catch(() => undefined));
    if ((step.model?.nextDeadline ?? null) !== deadline) clock?.reschedule();
  };

  /** Applies bb's latest data and the signals waiting with it, as one step. */
  const applyFrame = () => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    const waitingSignals = signals;
    signals = [];
    const current = api.getState().inputs;
    let next = current.host === host ? current : { ...current, host, idleSince: tracker?.idleSince ?? current.idleSince };
    for (const change of waitingSignals) next = { ...next, ...change(next) };
    if (next === current) return;
    // bb answering a read of a thread already shown read changes nothing
    // drawn: the list keeps its model and takes bb's data for the next step.
    const model = api.getState().model;
    if (waitingSignals.length === 0 && model !== null && onlyReadChanged(current, next, model)) {
      api.setState({ inputs: next });
      return;
    }
    commit(next);
  };
  const requestFrame = () => {
    if (frame === null) frame = frames.request(applyFrame);
  };
  /** The server's preferences, keeping any this window has not written yet. */
  const withPending = (preferences: unknown): Preferences => {
    const next = coercePreferences(preferences);
    // Keys with a write in flight keep the local value.
    for (const [key, value] of pending) (next as Record<string, unknown>)[key] = value;
    writeJson(PREFERENCES_MIRROR_STORAGE_KEY, next);
    return next;
  };
  const fetchMissingRecords = () => whenMounted(() => fetchMissing(store.edge.rpc, host.threads));
  const records = () => {
    const { stamps, notes } = pluginData.get().records;
    return { stamps, notes };
  };
  /** Applies a change of the plugin's data: signals with the next frame, answers at once. */
  const onData = (change: DataChange) => {
    const data = pluginData.get();
    switch (change.kind) {
      case "synced":
        store.feed(({ prefs }) => ({
          ...dataInputs(),
          prefs: data.preferences === null ? prefs : share(prefs, withPending(data.preferences)),
        }));
        fetchMissingRecords();
        return;
      case "failed":
        store.feed({ hydrated: true, stampsLoaded: true });
        return;
      case "records":
        if (change.at === "now") store.feed(records());
        else store.feedSignal(records);
        return;
      case "scheduled":
        store.feedSignal(() => ({ scheduled: pluginData.get().scheduled }));
        return;
      case "preference":
        store.receivePreference(change.key, change.value);
        return;
      case "facts":
        store.feed({ system: data.system, defaultBranches: data.defaultBranches });
        return;
    }
  };

  const scheduleWrite = () => {
    if (writeTimer !== null) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      store.flushPreferences();
    }, WRITE_DEBOUNCE_MS);
  };

  const store: ListStore = {
    ...api,
    edge: UNSET_EDGE,

    feedHost(next) {
      const shared = shareHost(host, next);
      if (sameHost(shared, host)) return;
      const first = host === NO_HOST;
      host = shared;
      if (shared.threads !== tracked) {
        tracked = shared.threads;
        fetchMissingRecords();
        // When the change was seen, not when it is drawn: the orphaned-failure
        // wait counts from here.
        tracker = trackIdle(tracker, shared.threads, Date.now());
        const unannounced = [...tracker.unannounced];
        if (unannounced.length > 0) {
          whenMounted(() => {
            if (store.edge.isIdleReporter()) store.edge.rpc.call("reportIdle", { threadIds: unannounced }).catch(() => undefined);
          });
        }
      }
      // Nothing is drawn yet, so the first data is drawn at once.
      if (first) applyFrame();
      else requestFrame();
    },

    feedSignal(change) {
      signals.push(change);
      requestFrame();
    },

    feedFocus(activeThreadId, nextCompact) {
      const { inputs: current, layout } = api.getState();
      if (nextCompact !== compact) {
        compact = nextCompact;
        if (activeThreadId === current.activeThreadId) api.setState({ layout: layoutOf(layout, current, compact) });
      }
      if (activeThreadId !== current.activeThreadId) commit({ ...current, activeThreadId });
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

    flush: applyFrame,

    receivePreferences(preferences) {
      const next = withPending(preferences);
      store.feed(({ prefs }) => ({ prefs: share(prefs, next), hydrated: true }));
    },

    receivePreference(key, value) {
      if (pending.has(key)) return;
      store.feed(({ prefs: current }) => {
        const prefs = { ...current, [key]: value };
        writeJson(PREFERENCES_MIRROR_STORAGE_KEY, prefs);
        return { prefs };
      });
    },

    updatePreferences(patch, also = {}) {
      const keys = Object.keys(patch);
      const current = api.getState().inputs.prefs;
      const prefs = keys.length === 0 ? current : { ...current, ...patch };
      if (keys.length > 0) writeJson(PREFERENCES_MIRROR_STORAGE_KEY, prefs);
      for (const [key, value] of Object.entries(patch)) if (isPreferenceKey(key)) pending.set(key, value);
      store.feed({ ...also, prefs });
      if (keys.length > 0) scheduleWrite();
    },

    flushPreferences() {
      if (writeTimer !== null) clearTimeout(writeTimer);
      writeTimer = null;
      const writes = [...pending];
      pending.clear();
      for (const [key, value] of writes) {
        store.edge.rpc.call("setPreference", { key, value }).catch((error: unknown) => {
          toast.error(`Couldn't save the ${key} setting`, {
            description: error instanceof Error ? error.message : String(error),
          });
        });
      }
    },

    updateClient(patch) {
      store.feed(({ client: current }) => {
        const client = { ...current, ...patch };
        writeJson(CLIENT_PREFERENCES_STORAGE_KEY, client);
        return { client };
      });
    },

    showRead(read, seen) {
      if (read.length === 0 && seen.length === 0) return;
      const byId = api.getState().model?.byId;
      // Held by the plugin's data, so a list mounted again shows them; applied here with the reads, in one step.
      if (seen.length > 0) pluginData.stamped("seenAt", seen, Date.now(), { quiet: true });
      store.feed(({ pendingRead }) => {
        const pending = new Map(pendingRead);
        for (const id of read) {
          const thread = byId?.get(id);
          if (thread !== undefined) pending.set(id, thread.latestAttentionAt);
        }
        return { pendingRead: pending, ...(seen.length > 0 ? records() : {}) };
      });
      if (seen.length > 0) store.edge.rpc.call("markSeen", { threadIds: [...seen] }).catch(() => undefined);
    },

    revertRead(threadIds) {
      store.feed(({ pendingRead }) => {
        if (!threadIds.some((id) => pendingRead.has(id))) return {};
        const pending = new Map(pendingRead);
        for (const id of threadIds) pending.delete(id);
        return { pendingRead: pending };
      });
    },

    clearSeen(threadIds) {
      if (threadIds.length === 0) return;
      pluginData.stamped("seenAt", threadIds, null);
      store.edge.rpc.call("clearSeen", { threadIds: [...threadIds] }).catch(() => undefined);
    },

    attach() {
      mounted = true;
      attached.add(store);
      const unfollow = pluginData.subscribe(onData);
      // What changed between the store's creation and its mount.
      store.feed(({ prefs }) => {
        const data = pluginData.get();
        return { ...dataInputs(), prefs: data.preferences === null ? prefs : share(prefs, withPending(data.preferences)) };
      });
      const requests = waiting;
      waiting = [];
      for (const request of requests) request();
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
        store.flushPreferences();
        attached.delete(store);
        mounted = false;
      };
    },
  };
  return store;
}
