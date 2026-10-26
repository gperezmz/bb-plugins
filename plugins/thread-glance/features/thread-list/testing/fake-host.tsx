// A fake bb and plugin server. bb's list hooks read a store the test drives,
// so bb can hand the list updates after mount (renderSlot's own host is fixed
// at mount). The list itself is mounted as bb mounts it: the plugin's
// registered thread list component, through renderSlot.
import { useSyncExternalStore, type ComponentType } from "react";
import { installTestPluginRuntime, loadPluginApp, renderSlot, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginProvidersState,
  PluginSidebarProject,
  PluginSidebarSplitLayout,
  PluginSidebarThread,
  PluginSidebarThreadRowStatus,
  PluginSidebarThreadShortcut,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { createFakeServer, type FakeServer, type FakeServerOptions } from "./fake-server";

interface HostState {
  status: "loading" | "ready" | "error";
  threads: PluginSidebarThread[];
  projects: PluginSidebarProject[];
  draftIds: ReadonlySet<string>;
  rowStatuses: ReadonlyMap<string, PluginSidebarThreadRowStatus>;
  splitLayout: PluginSidebarSplitLayout | null;
  props: PluginThreadListProps;
}

export interface FakeHostOptions {
  threads: PluginSidebarThread[];
  projects: PluginSidebarProject[];
  isCompactViewport?: boolean;
  activeThreadId?: string | null;
  /** Makes `threads.reorderPinned` fail. */
  failReorderPinned?: boolean;
  /** Counts how many times bb's list hook was read, to show no row reads it. */
  onThreadsRead?(): void;
}

export interface FakeHost {
  state(): HostState;
  /** Replaces what bb reports; one host update. */
  update(patch: Partial<Omit<HostState, "props">>): void;
  /** Replaces one thread, as bb does when it changes. */
  updateThread(id: string, patch: Partial<PluginSidebarThread>): void;
  /** Replaces the list's props; `onNavigate` gets a new identity. */
  updateProps(patch?: Partial<PluginThreadListProps>): void;
  /** Every call to bb's SDK the list made, as `<area>.<method>` with its arguments, and each to GitHub PR Status's `pullRequests`. */
  sdkCalls: { method: string; args: unknown }[];
  /** How many times the list's `onNavigate` ran. */
  navigated: number;
  subscribe(listener: () => void): () => void;
}

let active: FakeHost | null = null;

function hostOrThrow(): FakeHost {
  if (active === null) throw new Error("no fake host: call createFakeHost first");
  return active;
}

export function createFakeHost(options: FakeHostOptions): FakeHost {
  const listeners = new Set<() => void>();
  let state: HostState = {
    status: "ready",
    threads: options.threads,
    projects: options.projects,
    draftIds: new Set(),
    rowStatuses: new Map(),
    splitLayout: null,
    props: {
      activeThreadId: options.activeThreadId ?? null,
      activeProjectId: null,
      isCompactViewport: options.isCompactViewport ?? false,
      onNavigate: () => {
        host.navigated += 1;
      },
      searchQuery: "",
    },
  };
  let sidebar = sidebarOf(state);
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const host: FakeHost = {
    state: () => state,
    update(patch) {
      state = { ...state, ...patch };
      if (patch.threads !== undefined || patch.projects !== undefined || patch.status !== undefined) sidebar = sidebarOf(state);
      notify();
    },
    updateThread(id, patch) {
      host.update({ threads: state.threads.map((thread) => (thread.id === id ? { ...thread, ...patch } : thread)) });
    },
    updateProps(patch = {}) {
      state = { ...state, props: { ...state.props, onNavigate: () => void (host.navigated += 1), ...patch } };
      notify();
    },
    sdkCalls: [],
    navigated: 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  hostSidebar = () => sidebar;
  readCount = options.onThreadsRead ?? (() => {});
  failReorderPinned = options.failReorderPinned ?? false;
  active = host;
  return host;
}

let hostSidebar: () => unknown = () => null;
let readCount: () => void = () => {};
let failReorderPinned = false;

function sidebarOf(state: HostState) {
  return { status: state.status, threads: state.threads, projects: state.projects, sections: [], experimental_archived: null };
}

function useHost<T>(select: (state: HostState) => T): T {
  const host = hostOrThrow();
  return useSyncExternalStore(host.subscribe, () => select(host.state()));
}

type Runtime = Record<string, (...args: never[]) => unknown>;

const rowRenders = new Map<string, number>();

/** How many times each thread's row rendered since the last reset: a row calls bb's split hook once per render. */
export function rowRenderCounts(): ReadonlyMap<string, number> {
  return rowRenders;
}

export function resetRowRenderCounts(): void {
  rowRenders.clear();
}

/**
 * bb's `ThreadTitle` for the fake host: the thread's `displayTitle` in a span
 * marked with its id, read from the threads the test drives. The SDK's own
 * test stand-in reads the slot's environment instead, which the fake host does
 * not feed, and draws nothing for an unknown thread, as bb does. bb's own
 * ThreadTitle also needs the sidebar's `SidebarThreadEntriesProvider` and
 * throws "SidebarThreadEntriesProvider is required" without it, as in a toast
 * (bb's toaster sits outside the sidebar); this stand-in draws anywhere, so a
 * test cannot see a ThreadTitle placed where bb throws, and only a drive in bb does.
 */
function FakeThreadTitle({ threadId }: { threadId: string }) {
  const thread = useHost((state) => state.threads).find((candidate) => candidate.id === threadId);
  return thread === undefined ? null : <span data-thread-title={threadId}>{thread.displayTitle}</span>;
}

function fakeHooks(testRuntime: Runtime): Runtime {
  const split = testRuntime.experimental_useSidebarThreadSplit as (threadId: string) => unknown;
  return {
    experimental_useSidebarThreadSplit: (threadId: string) => {
      rowRenders.set(threadId, (rowRenders.get(threadId) ?? 0) + 1);
      return split(threadId);
    },
    experimental_useSidebarThreads: () => {
      useHost((state) => state.threads);
      useHost((state) => state.status);
      useHost((state) => state.projects);
      readCount();
      return hostSidebar();
    },
    useSidebarThreadDraftIds: () => useHost((state) => state.draftIds),
    useSidebarThreadRowStatuses: () => useHost((state) => state.rowStatuses),
    useSidebarSplitLayout: () => useHost((state) => state.splitLayout),
    ThreadTitle: FakeThreadTitle as never,
  };
}

/** What a test adds to bb's side of the slot: pull requests, providers, and SDK areas the list calls. */
export interface SlotExtras {
  /**
   * GitHub PR Status's `pullRequests` rows by environment id, as the plugin
   * answers them; an environment not listed has no pull request. Null makes
   * every call fail, as a disabled or absent plugin does.
   */
  pullRequests?: Record<string, unknown> | null;
  /** The jump keys bb assigned, by thread id, as if its modifier were held. */
  sidebarShortcuts?: Record<string, PluginSidebarThreadShortcut>;
  providers?: Partial<PluginProvidersState>;
  sdk?: Record<string, Record<string, unknown>>;
}

type PluginApp = Awaited<ReturnType<typeof loadPluginApp>>;
let app: PluginApp | null = null;

/**
 * Loads the plugin app against the fake host. bb's SDK module looks each hook
 * up on the test runtime when it is called, and `loadPluginApp` and
 * `renderSlot` install that runtime afresh with one shared object of hooks, so
 * the fake hooks go onto that object; a runtime without them would test the
 * wrong host, which this refuses.
 */
export async function loadWithFakeHost(): Promise<PluginApp> {
  if (app !== null) return app;
  installTestPluginRuntime();
  const runtime = (globalThis as unknown as { __bbPluginRuntime: { pluginSdkApp: Runtime } }).__bbPluginRuntime;
  const hooks = fakeHooks({ ...runtime.pluginSdkApp });
  Object.assign(runtime.pluginSdkApp, hooks);
  app = await loadPluginApp(() => import("../../../app"));
  const installed = (globalThis as unknown as { __bbPluginRuntime: { pluginSdkApp: Runtime } }).__bbPluginRuntime.pluginSdkApp;
  if (installed.experimental_useSidebarThreads !== hooks.experimental_useSidebarThreads) {
    throw new Error("the test runtime dropped the fake host's hooks while the app loaded");
  }
  return app;
}

export type ServerState = FakeServer;

/** A fake plugin server holding what `held` gives it. */
export function serverState(held: FakeServerOptions = {}): ServerState {
  return createFakeServer(held);
}

/** bb's SDK calls the list makes, answered at once and recorded; `extra` adds areas and methods. */
function sdkFakes(extra: Record<string, Record<string, unknown>> = {}) {
  const record = (method: string) => async (args: unknown) => {
    hostOrThrow().sdkCalls.push({ method, args });
    return {};
  };
  const base: Record<string, Record<string, unknown>> = {
    threads: {
      update: async (args: { threadId: string; title?: string }) => {
        hostOrThrow().sdkCalls.push({ method: "threads.update", args });
        if (args.title !== undefined) hostOrThrow().updateThread(args.threadId, { title: args.title, displayTitle: args.title });
        return {};
      },
      pin: record("threads.pin"),
      unpin: async (args: { threadId: string }) => {
        hostOrThrow().sdkCalls.push({ method: "threads.unpin", args });
        hostOrThrow().updateThread(args.threadId, { isPinned: false, pinnedAt: null });
        return {};
      },
      reorderPinned: async (args: { threadId: string; previousThreadId: string | null; nextThreadId: string | null }) => {
        hostOrThrow().sdkCalls.push({ method: "threads.reorderPinned", args });
        if (failReorderPinned) throw new Error("reorder failed");
        const host = hostOrThrow();
        // Rewrite pin keys so the pinned threads sort as bb's reorder would put them.
        const pinned = host.state().threads.filter((thread) => thread.isPinned);
        const sorted = pinned.filter((thread) => thread.id !== args.threadId).sort(comparePinKeys);
        const at = args.previousThreadId === null ? 0 : sorted.findIndex((thread) => thread.id === args.previousThreadId) + 1;
        const ids = sorted.map((thread) => thread.id);
        ids.splice(at, 0, args.threadId);
        host.update({
          threads: host.state().threads.map((thread) => (thread.isPinned ? { ...thread, pinSortKey: String(ids.indexOf(thread.id)).padStart(4, "0") } : thread)),
        });
        return {};
      },
    },
  };
  const merged = { ...base };
  for (const [area, methods] of Object.entries(extra)) merged[area] = { ...base[area], ...methods };
  return merged as never;
}

function comparePinKeys(a: PluginSidebarThread, b: PluginSidebarThread): number {
  return (a.pinSortKey ?? "~").localeCompare(b.pinSortKey ?? "~") || (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
}

/** The list as a window mounts it, fed props by the fake host. */
export function mountList(loaded: PluginApp, server: ServerState, slot: SlotExtras = {}): RenderedSlot {
  const List = loaded.threadLists[0]!.component as ComponentType<PluginThreadListProps>;
  const Window = () => <List {...useHost((state) => state.props)} />;
  const { sdk, pullRequests = {}, ...options } = slot;
  // bb's test runtime answers every plugin's RPC from these handlers, GitHub PR Status's among them.
  const rpc = { ...server.handlers, pullRequests: githubPrStatus(pullRequests) };
  return server.attach(renderSlot({ component: Window }, {}, { rpc: rpc as never, sdk: sdkFakes(sdk), realtimeConnectionState: "connected", ...options }));
}

/** GitHub PR Status's `pullRequests`, answering from `rows`. */
function githubPrStatus(rows: Record<string, unknown> | null) {
  return async ({ keys }: { keys: string[] }) => {
    hostOrThrow().sdkCalls.push({ method: "bb--github-pr-status.pullRequests", args: { keys } });
    if (rows === null) throw new Error('plugin "bb--github-pr-status" is not running (status: disabled)');
    return Object.fromEntries(keys.map((key) => [key, rows[key] ?? { outcome: "absent" }]));
  };
}
