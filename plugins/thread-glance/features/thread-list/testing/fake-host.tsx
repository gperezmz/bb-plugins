// A fake bb and plugin server. bb's list hooks read a store the test drives,
// so bb can hand the list updates after mount (renderSlot's own host is fixed
// at mount), a new `actions` object on every update as bb 0.44 does, and a
// `threads.markRead` that takes time. The list itself is mounted as bb mounts
// it: the plugin's registered thread list component, through renderSlot.
import { useSyncExternalStore, type ComponentType } from "react";
import { installTestPluginRuntime, loadPluginApp, renderSlot, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginEnvironmentProvider,
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarSplitLayout,
  PluginSidebarThread,
  PluginSidebarThreadRowStatus,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type { Preferences } from "@/shared/preferences";
import { createFakeServer, type FakeServer, type FakeServerOptions } from "./fixtures";

interface Provider {
  id: string;
  displayName: string;
  logoUrl: string | null;
}

interface HostState {
  threads: PluginSidebarThread[];
  projects: PluginSidebarProject[];
  sections: PluginSidebarSection[];
  providers: Provider[];
  environmentProviders: PluginEnvironmentProvider[];
  draftIds: ReadonlySet<string>;
  rowStatuses: ReadonlyMap<string, PluginSidebarThreadRowStatus>;
  splitLayout: PluginSidebarSplitLayout | null;
  props: PluginThreadListProps;
}

export interface FakeHostOptions {
  threads: PluginSidebarThread[];
  projects: PluginSidebarProject[];
  sections?: PluginSidebarSection[];
  /** Hand the list a new `actions` object on every host update, as bb 0.44 does. */
  freshActions?: boolean;
  /** How long `threads.markRead` takes to answer. */
  markReadMs?: number;
  /** Threads whose `threads.markRead` fails. */
  failRead?: (threadId: string) => boolean;
  /** Hold every `threads.markRead` unanswered until `releaseReads`. */
  holdReads?: boolean;
  isCompactViewport?: boolean;
}

const PROVIDERS: Provider[] = [
  { id: "claude-code", displayName: "Claude Code", logoUrl: null },
  { id: "codex", displayName: "Codex", logoUrl: null },
  { id: "pi", displayName: "Pi", logoUrl: null },
];

export interface FakeHost {
  state(): HostState;
  /** Replaces what bb reports; one host update. */
  update(patch: Partial<Omit<HostState, "props">>): void;
  /** Replaces one thread, as bb does when it changes. */
  updateThread(id: string, patch: Partial<PluginSidebarThread>): void;
  /** Replaces the list's props; `onNavigate` gets a new identity. */
  updateProps(patch?: Partial<PluginThreadListProps>): void;
  /** bb's `threads.markRead`: answers after `markReadMs`, and bb's list shows the thread read soon after. */
  markRead(args: { threadId: string }): Promise<{ id: string }>;
  /** Most `threads.markRead` calls bb held at once. */
  markReadPeak: number;
  /** Resolves once no `threads.markRead` is in flight. */
  markReadSettled(): Promise<void>;
  /** Answers every held `threads.markRead`, and stops holding. */
  releaseReads(): void;
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
    threads: options.threads,
    projects: options.projects,
    sections: options.sections ?? [],
    providers: PROVIDERS,
    environmentProviders: [],
    draftIds: new Set(),
    rowStatuses: new Map(),
    splitLayout: null,
    props: {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: options.isCompactViewport ?? false,
      onNavigate() {},
      searchQuery: "",
    },
  };
  let inFlight = 0;
  let idle: (() => void)[] = [];
  const answered = new Set<string>();
  let holding = options.holdReads ?? false;
  let held: (() => void)[] = [];
  const applyAnswers = () => {
    const now = Date.now();
    const changes = new Set(answered);
    answered.clear();
    host.update({
      threads: state.threads.map((thread) => (changes.has(thread.id) ? { ...thread, isUnread: false, lastReadAt: now } : thread)),
    });
    if (inFlight === 0) settleIdle();
  };
  const settleIdle = () => {
    const waiting = idle;
    idle = [];
    for (const resolve of waiting) resolve();
  };
  const makeActions = () => ({
    open() {},
    openNewThread() {},
    async setPinned() {},
    async setRead() {},
    async rename() {},
    archive() {},
    requestDelete() {},
  });
  let actions = makeActions();
  let sidebar = sidebarOf(state);
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const host: FakeHost = {
    state: () => state,
    update(patch) {
      state = { ...state, ...patch };
      if (patch.threads !== undefined || patch.projects !== undefined || patch.sections !== undefined) {
        sidebar = sidebarOf(state);
      }
      if (options.freshActions) actions = makeActions();
      notify();
    },
    updateThread(id, patch) {
      host.update({ threads: state.threads.map((thread) => (thread.id === id ? { ...thread, ...patch } : thread)) });
    },
    updateProps(patch = {}) {
      state = { ...state, props: { ...state.props, onNavigate() {}, ...patch } };
      notify();
    },
    async markRead({ threadId }) {
      inFlight += 1;
      host.markReadPeak = Math.max(host.markReadPeak, inFlight);
      if (holding) await new Promise<void>((resolve) => held.push(resolve));
      await new Promise((resolve) => setTimeout(resolve, options.markReadMs ?? 0));
      inFlight -= 1;
      if (options.failRead?.(threadId)) {
        if (inFlight === 0) settleIdle();
        throw new Error("read failed");
      }
      answered.add(threadId);
      // Answers that land together reach the list as one update, as bb's
      // refresh after them does.
      if (answered.size === 1) setTimeout(applyAnswers, 0);
      return { id: threadId };
    },
    markReadPeak: 0,
    releaseReads() {
      holding = false;
      const waiting = held;
      held = [];
      for (const resolve of waiting) resolve();
    },
    markReadSettled: () => (inFlight === 0 ? Promise.resolve() : new Promise((resolve) => idle.push(resolve))),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  hostActions = () => actions;
  hostSidebar = () => sidebar;
  active = host;
  return host;
}

let hostActions: () => unknown = () => null;
let hostSidebar: () => unknown = () => null;

function sidebarOf(state: HostState) {
  return {
    status: "ready" as const,
    threads: state.threads,
    projects: state.projects,
    sections: state.sections,
    experimental_archived: null,
  };
}

function useHost<T>(select: (state: HostState) => T): T {
  const host = hostOrThrow();
  return useSyncExternalStore(host.subscribe, () => select(host.state()));
}

type Runtime = Record<string, (...args: never[]) => unknown>;

function fakeHooks(testRuntime: Runtime): Runtime {
  const passThrough =
    (name: string) =>
    (...args: unknown[]) =>
      (testRuntime[name] as (...args: unknown[]) => unknown)(...args);
  const noDraft = { hasUnsubmittedDraft: false };
  const withDraft = { hasUnsubmittedDraft: true };
  return {
    experimental_useSidebarThreads: () => {
      useHost((state) => state.threads);
      return hostSidebar();
    },
    experimental_useSidebarThreadActions: () => {
      return useHost(() => hostActions());
    },
    experimental_useProviders: () => {
      const providers = useHost((state) => state.providers);
      return useProvidersState(providers);
    },
    useEnvironmentProviders: () => {
      const providers = useHost((state) => state.environmentProviders);
      return useEnvironmentState(providers);
    },
    useSidebarThreadDraft: (threadId: string) =>
      useHost((state) => state.draftIds.has(threadId)) ? withDraft : noDraft,
    useSidebarThreadDraftIds: () => useHost((state) => state.draftIds),
    useSidebarThreadRowStatus: (threadId: string) =>
      useHost((state) => state.rowStatuses.get(threadId) ?? null),
    useSidebarThreadRowStatuses: () => useHost((state) => state.rowStatuses),
    useSidebarSplitLayout: () => useHost((state) => state.splitLayout),
    useSidebarThreadShortcut: passThrough("useSidebarThreadShortcut"),
    experimental_useSidebarThreadSplit: passThrough("experimental_useSidebarThreadSplit"),
    experimental_useSidebarThreadPullRequest: passThrough("experimental_useSidebarThreadPullRequest"),
  };
}

// One state object per provider list, as bb's query cache hands out.
const providerStates = new WeakMap<object, unknown>();
function useProvidersState(providers: Provider[]) {
  let value = providerStates.get(providers);
  if (value === undefined) {
    value = { status: "ready", providers };
    providerStates.set(providers, value);
  }
  return value;
}
function useEnvironmentState(providers: PluginEnvironmentProvider[]) {
  return useProvidersState(providers as never);
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

/** The fake plugin server a run mounts its windows against (see `createFakeServer`). */
export type ServerState = FakeServer;

/** A fake plugin server with `patch` over the default preferences, holding what `held` gives it. */
export function serverState(patch: Partial<Preferences> = {}, held: Omit<FakeServerOptions, "preferences"> = {}): ServerState {
  return createFakeServer({ ...held, preferences: patch });
}

/** bb's SDK calls the list makes, answered at once. */
const SDK_FAKES = {
  threads: {
    defaultExecutionOptions: async () => null,
    update: async () => ({}),
    unpin: async () => ({}),
    unarchive: async () => ({}),
    reorderPinned: async () => ({}),
    markRead: (args: { threadId: string }) => hostOrThrow().markRead(args),
  },
  projects: {
    get: async () => ({ sources: [{ hostId: "host_1", isDefault: true }] }),
    branches: async () => ({ defaultBranch: "main" }),
  },
  providers: { models: async () => ({ models: [] }) },
  system: {
    config: async () => ({
      primaryHostId: "host_1",
      generalSettings: { defaultProviderId: "claude-code" },
      serverAccess: { defaultProviderId: "claude-code" },
    }),
  },
} as never;

/** The list as a window mounts it, fed props by the fake host. */
export function mountList(app: PluginApp, server: ServerState): RenderedSlot {
  const List = app.threadLists[0]!.component as ComponentType<PluginThreadListProps>;
  const Window = () => <List {...useHost((state) => state.props)} />;
  return server.attach(renderSlot({ component: Window }, {}, { rpc: server.handlers as never, sdk: SDK_FAKES, realtimeConnectionState: "connected" }));
}
