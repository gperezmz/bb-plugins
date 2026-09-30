// Test fixtures: sidebar threads, projects, a ready-made view builder, and a
// fake plugin server.
import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type PreferenceKey, type Preferences } from "@/shared/preferences";
import { CHANNELS, type StampKind, type Stamps, type ThreadNotes } from "@/shared/signals";
import { attachedListStores } from "../store/api";
import { endPluginLifetime } from "../sync/lifetime";
import { buildForest, type Forest } from "../model/trees";
import { buildListView, type ListView, type Row } from "../model/view";
import type { Targets } from "../model/expansion";
import type { SettleInputs } from "../model/settled";

export const T0 = 1_780_000_000_000;

type ThreadOverrides = Omit<Partial<PluginSidebarThread>, "activity" | "environment"> & {
  id: string;
  activity?: Partial<PluginSidebarThread["activity"]>;
  environment?: Partial<NonNullable<PluginSidebarThread["environment"]>> | null;
};

/** A read, idle root thread in `proj_a`, created at T0. */
export function makeThread(overrides: ThreadOverrides): PluginSidebarThread {
  const { activity, environment, ...rest } = overrides;
  const title = rest.title ?? `Thread ${overrides.id}`;
  return {
    projectId: "proj_a",
    title,
    titleFallback: null,
    displayTitle: rest.displayTitle ?? title,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/${rest.projectId ?? "proj_a"}/threads/${overrides.id}`,
    isHidden: false,
    host: { id: "host_1", name: "Laptop" },
    createdAt: T0,
    updatedAt: T0,
    lastReadAt: T0,
    latestAttentionAt: T0,
    ...rest,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
      ...activity,
    },
    environment:
      environment === null
        ? null
        : {
            id: "env_main",
            name: null,
            branchName: "main",
            path: "/work/repo",
            isWorktree: false,
            providerId: null,
            workspaceDisplayKind: null,
            ...environment,
          },
  } as PluginSidebarThread;
}

export const working = { status: "active", runtimeStatus: "active" } as const;
export const failedUnread = { status: "error", latestAttentionAt: T0 + 10, lastReadAt: T0 } as const;
export const finishedUnread = { status: "idle", latestAttentionAt: T0 + 10, lastReadAt: T0 } as const;

export function makeProject(
  id: string,
  name = id,
  overrides: Partial<PluginSidebarProject> = {},
): PluginSidebarProject {
  return {
    id,
    name,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
    ...overrides,
  };
}

export const PROJECTS: PluginSidebarProject[] = [
  makeProject("proj_personal", "Personal", { isPersonal: true }),
  makeProject("proj_a", "Alpha"),
  makeProject("proj_b", "Beta"),
];

export interface Scenario {
  threads: PluginSidebarThread[];
  projects?: PluginSidebarProject[];
  sections?: PluginSidebarSection[];
  prefs?: Partial<Preferences>;
  activeThreadId?: string | null;
  /** Threads other split panes show. */
  openThreadIds?: string[];
  targets?: Targets;
  finishedAt?: Record<string, number>;
  seenAt?: Record<string, number>;
  scheduled?: Record<string, number>;
  draftIds?: string[];
  notes?: Record<string, import("@/shared/signals").ThreadNotes>;
  now?: number;
  startedAt?: Record<string, number>;
  pendingAt?: Record<string, number>;
  /** When this list saw each thread go idle, and the server's idleAt stamps. */
  idleSince?: Record<string, number>;
  idleAt?: Record<string, number>;
  stampsLoaded?: boolean;
  /** Project id → default branch; "main" for every project when absent. */
  defaultBranches?: Record<string, string | null>;
  /** bb's primary machine; "host_1", the fixtures' own, when absent. */
  primaryHostId?: string | null;
  showBranchLine?: boolean;
  needYouOnly?: boolean;
  /** Roots of settled trees held out of the fold; none when absent. */
  held?: readonly string[];
  /** bb's default harness; "claude-code", the fixtures' own, when absent. */
  defaultProviderId?: string | null;
}

export function forestOf(scenario: Scenario): Forest {
  return buildForest({
    threads: scenario.threads,
    activeThreadId: scenario.activeThreadId ?? null,
    openThreadIds: new Set(scenario.openThreadIds ?? []),
    finishedAt: scenario.finishedAt ?? {},
    seenAt: scenario.seenAt ?? {},
    scheduled: scenario.scheduled ?? {},
    draftIds: new Set(scenario.draftIds ?? []),
    notes: scenario.notes ?? {},
    childAttention: scenario.prefs?.childAttention,
    now: scenario.now ?? T0 + 60_000,
    idleSince: scenario.idleSince,
    idleAt: scenario.idleAt,
    stampsLoaded: scenario.stampsLoaded,
  });
}

export function viewOf(scenario: Scenario): ListView {
  const forest = forestOf(scenario);
  return buildListView({
    forest,
    threads: scenario.threads,
    projects: scenario.projects ?? PROJECTS,
    sections: scenario.sections ?? [],
    prefs: { ...defaultPreferences(), ...scenario.prefs },
    activeThreadId: scenario.activeThreadId ?? null,
    targets: scenario.targets ?? new Map(),
    settle: settleOf(scenario),
    held: new Set(scenario.held ?? []),
    defaultProviderId: scenario.defaultProviderId === undefined ? "claude-code" : scenario.defaultProviderId,
    primaryHostId: scenario.primaryHostId === undefined ? "host_1" : scenario.primaryHostId,
    showBranchLine: scenario.showBranchLine ?? false,
    needYouOnly: scenario.needYouOnly ?? false,
    pendingAt: scenario.pendingAt ?? {},
    defaultBranchOf: (thread) =>
      scenario.defaultBranches === undefined ? "main" : scenario.defaultBranches[thread.projectId],
  });
}

/** The settle inputs a scenario stands for. */
export function settleOf(scenario: Scenario): SettleInputs {
  return {
    now: scenario.now ?? T0 + 60_000,
    settleAfter: scenario.prefs?.settleAfter ?? defaultPreferences().settleAfter,
    startedAt: scenario.startedAt ?? {},
    finishedAt: scenario.finishedAt ?? {},
  };
}

function idsOf(rows: readonly Row[]): string[] {
  return rows.map((row) =>
    row.type === "thread"
      ? row.info.thread.id
      : row.type === "older"
        ? `older:${row.count}`
        : row.type === "settled"
          ? `settled:${row.count}`
          : `env:${row.environmentId}`,
  );
}

/** Thread ids in the group's rows, in order; older rows as `older:N`. */
export function rowIds(view: ListView, groupId: string): string[] {
  const group = [...view.groups, ...view.more].find((candidate) => candidate.descriptor.id === groupId);
  if (group === undefined) throw new Error(`no group ${groupId}`);
  return idsOf(group.rows);
}

/** Roots of the trees that need attention, in the forest's order. */
export function attentionRootIds(scenario: Scenario): string[] {
  return forestOf(scenario)
    .trees.filter((tree) => tree.attentionFlags.size > 0)
    .map((tree) => tree.root.thread.id);
}

/** Which generated list: the live list, nothing settled yet, or the settled list, two days on. */
export type GeneratedListKind = "live" | "settled";

export interface GeneratedList {
  threads: PluginSidebarThread[];
  projects: PluginSidebarProject[];
  /** The clock the list is mounted at. */
  now: number;
  /** Threads bb reports unread, in list order. */
  unreadIds: string[];
}

interface GenerateOptions {
  /** Threads in the list. */
  size: number;
  kind?: GeneratedListKind;
  /** Unread threads; about 5 % of the list when absent. */
  unread?: number;
  seed?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** A seeded pseudo-random source (mulberry32), so a seed always gives one list. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Projects of a generated list: one group each under project grouping. */
const GENERATED_PROJECTS: PluginSidebarProject[] = [1, 2, 3, 4].map((index) =>
  makeProject(`proj_${index}`, `Project ${index}`),
);

/**
 * A list shaped like the seeded bb the audit measured: two thirds top-level
 * threads, five child threads per parent thread, four groups and about 95 %
 * read. Every thread's last activity falls in the day before T0, so nothing
 * is settled at T0 ("live"), and every read, idle tree is settled two days on
 * ("settled").
 */
export function generateList({ size, kind = "live", unread, seed = 145 }: GenerateOptions): GeneratedList {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const rootCount = Math.round((size * 2) / 3);
  const childCount = size - rootCount;
  const parentCount = Math.ceil(childCount / 5);
  const threads: PluginSidebarThread[] = [];
  const roots: PluginSidebarThread[] = [];
  for (let index = 0; index < rootCount; index += 1) {
    // Newest first: the list sorts by activity, so ids read top to bottom.
    const at = T0 - Math.floor(((index + random()) / rootCount) * 20 * 60 * 60 * 1000);
    const root = makeThread({
      id: `t${index}`,
      title: `Thread ${index}`,
      projectId: pick(GENERATED_PROJECTS).id,
      createdAt: at - 60_000,
      updatedAt: at,
      latestAttentionAt: at,
      lastReadAt: at,
    });
    roots.push(root);
    threads.push(root);
  }
  // Parents spread through the list rather than bunched at its top.
  const stride = rootCount / parentCount;
  for (let parent = 0; parent < parentCount; parent += 1) {
    const root = roots[Math.floor(parent * stride)]!;
    for (let child = 0; child < 5 && threads.length < size; child += 1) {
      const at = root.updatedAt - (child + 1) * 1_000;
      threads.push(
        makeThread({
          id: `${root.id}c${child}`,
          title: `${root.title} child ${child}`,
          projectId: root.projectId,
          parentThreadId: root.id,
          createdAt: at - 60_000,
          updatedAt: at,
          latestAttentionAt: at,
          lastReadAt: at,
        }),
      );
    }
  }
  const unreadCount = unread ?? Math.round(size * 0.05);
  const order = threads.map((_, index) => index).sort(() => random() - 0.5);
  const unreadIndexes = new Set(order.slice(0, unreadCount));
  for (const index of unreadIndexes) {
    const thread = threads[index]!;
    threads[index] = { ...thread, isUnread: true, lastReadAt: thread.latestAttentionAt - 1 };
  }
  return {
    threads,
    projects: GENERATED_PROJECTS,
    now: kind === "live" ? T0 + 60_000 : T0 + 2 * DAY,
    unreadIds: threads.filter((thread) => thread.isUnread).map((thread) => thread.id),
  };
}

/** The Mark all read list: 1,500 threads, 443 of them unread. */
export function markAllReadList(seed = 145): GeneratedList {
  return generateList({ size: 1_500, unread: 443, seed });
}

/** What a fake server's `records` signal and `sync` carry, per thread. */
type FakeRecord = { stamps: Partial<Record<StampKind, number>> | null; notes: ThreadNotes | null };

export interface FakeServerOptions {
  /** Merged over the defaults. */
  preferences?: Partial<Preferences>;
  stamps?: Partial<Stamps>;
  notes?: Record<string, ThreadNotes>;
  scheduled?: Record<string, number>;
  /** Threads the server holds as archived, which `sync` leaves out. */
  archived?: readonly string[];
}

/** A window the fake server publishes to: a rendered slot. */
interface FakeWindow {
  emitRealtime(channel: string, payload: unknown): Promise<void>;
}

/**
 * The plugin server as the app sees it: `sync` and the other RPC methods
 * over what it holds, and realtime signals to the windows attached to it.
 * Created while no list is mounted, it starts a new plugin lifetime in this
 * test's window, as a reload of the app would, so nothing held from an
 * earlier test carries over; created beside a mounted list, it is another
 * window's server and leaves the lifetime alone.
 */
export function createFakeServer(options: FakeServerOptions = {}) {
  if (attachedListStores().length === 0) endPluginLifetime();
  const epoch = `fake-${(fakeServers += 1)}`;
  let revision = 0;
  const changed = new Map<string, number>();
  const records = new Map<string, FakeRecord>();
  const archived = new Set(options.archived ?? []);
  const windows = new Set<FakeWindow>();
  let preferences: Preferences = { ...defaultPreferences(), ...options.preferences };
  let scheduled: Record<string, number> = { ...options.scheduled };

  const recordOf = (threadId: string): FakeRecord => records.get(threadId) ?? { stamps: null, notes: null };
  const put = (threadId: string, record: FakeRecord) => {
    const stamps = record.stamps !== null && Object.keys(record.stamps).length > 0 ? record.stamps : null;
    const notes = record.notes !== null && Object.keys(record.notes).length > 0 ? record.notes : null;
    if (stamps === null && notes === null) records.delete(threadId);
    else records.set(threadId, { stamps, notes });
  };
  for (const [kind, map] of Object.entries(options.stamps ?? {}) as [StampKind, Record<string, number>][]) {
    for (const [threadId, value] of Object.entries(map)) {
      const record = recordOf(threadId);
      put(threadId, { ...record, stamps: { ...record.stamps, [kind]: value } });
    }
  }
  for (const [threadId, notes] of Object.entries(options.notes ?? {})) put(threadId, { ...recordOf(threadId), notes });

  const publish = async (channel: string, payload: unknown) => {
    for (const window of [...windows]) await window.emitRealtime(channel, payload);
  };
  /** Takes a revision for the threads a change touched and publishes their records in one signal. */
  const publishRecords = async (threadIds: readonly string[]) => {
    if (threadIds.length === 0) return;
    revision += 1;
    for (const threadId of threadIds) changed.set(threadId, revision);
    await publish(CHANNELS.records, {
      epoch,
      revision,
      records: Object.fromEntries(threadIds.map((threadId) => [threadId, recordOf(threadId)])),
    });
  };
  const stampLocally = (kind: StampKind, threadIds: readonly string[], value: number | null) => {
    for (const threadId of threadIds) {
      const { [kind]: _old, ...rest } = recordOf(threadId).stamps ?? {};
      put(threadId, { ...recordOf(threadId), stamps: value === null ? rest : { ...rest, [kind]: value } });
    }
  };

  const server = {
    /** Every call the windows made, by method, in order. */
    calls: [] as { method: string; input: unknown }[],
    handlers: {
      sync: ({ since }: { since: { epoch: string; revision: number } | null }) => {
        server.calls.push({ method: "sync", input: { since } });
        const full = since === null || since.epoch !== epoch;
        const ids = full
          ? [...records.keys()].filter((threadId) => !archived.has(threadId))
          : [...changed].flatMap(([threadId, at]) => (at > since.revision ? [threadId] : []));
        return {
          epoch,
          revision,
          full,
          preferences,
          scheduled: { status: "ready" as const, scheduled },
          records: Object.fromEntries(ids.map((threadId) => [threadId, recordOf(threadId)])),
        };
      },
      fetchArchived: ({ threadIds }: { threadIds: string[] }) => {
        server.calls.push({ method: "fetchArchived", input: { threadIds } });
        return {
          epoch,
          revision,
          records: Object.fromEntries(threadIds.flatMap((threadId) => (records.has(threadId) ? [[threadId, recordOf(threadId)]] : []))),
        };
      },
      setPreference: ({ key, value }: { key: PreferenceKey; value: unknown }) => {
        server.calls.push({ method: "setPreference", input: { key, value } });
        preferences = { ...preferences, [key]: value };
        return { key, value };
      },
      resetPreference: ({ key }: { key: PreferenceKey }) => {
        server.calls.push({ method: "resetPreference", input: { key } });
        preferences = { ...preferences, [key]: defaultPreferences()[key] };
        return { key, value: preferences[key] };
      },
      importPreferences: (input: unknown) => {
        server.calls.push({ method: "importPreferences", input });
        return { status: "already-imported" as const, source: null, keys: [] as PreferenceKey[] };
      },
      markSeen: ({ threadIds }: { threadIds: string[] }) => {
        server.calls.push({ method: "markSeen", input: { threadIds } });
        const at = Date.now();
        stampLocally("seenAt", threadIds, at);
        return { at };
      },
      clearSeen: ({ threadIds }: { threadIds: string[] }) => {
        server.calls.push({ method: "clearSeen", input: { threadIds } });
        stampLocally("seenAt", threadIds, null);
        return { ok: true as const };
      },
      reportIdle: ({ threadIds }: { threadIds: string[] }) => {
        server.calls.push({ method: "reportIdle", input: { threadIds } });
        return { ok: true as const };
      },
    },
    get preferences() {
      return preferences;
    },
    /** This server's epoch, which a `records` signal names. */
    epoch,
    /** Publishes to `window` from now on; returns it. */
    attach<W extends FakeWindow>(window: W): W {
      windows.add(window);
      return window;
    },
    /** Stops publishing to `window`, as its list unmounting stops it hearing. */
    detach(window: FakeWindow): void {
      windows.delete(window);
    },
    /** Sets `kind` for each thread, or deletes it with null, and publishes their records. */
    async stamp(kind: StampKind, threadIds: readonly string[], value: number | null): Promise<void> {
      stampLocally(kind, threadIds, value);
      await publishRecords(threadIds);
    },
    /** Replaces a thread's notes, or deletes them with null, and publishes its record. */
    async note(threadId: string, notes: ThreadNotes | null): Promise<void> {
      put(threadId, { ...recordOf(threadId), notes });
      await publishRecords([threadId]);
    },
    /** Changes a preference, as another window or the CLI does, and publishes it. */
    async setPreference(key: PreferenceKey, value: unknown): Promise<void> {
      preferences = { ...preferences, [key]: value };
      await publish(CHANNELS.preferences, { key, value });
    },
    async setScheduled(next: Record<string, number>): Promise<void> {
      scheduled = next;
      await publish(CHANNELS.scheduled, { status: "ready", scheduled });
    },
    archive(threadId: string): void {
      archived.add(threadId);
    },
    unarchive(threadId: string): void {
      archived.delete(threadId);
    },
  };
  return server;
}
export type FakeServer = ReturnType<typeof createFakeServer>;

let fakeServers = 0;
