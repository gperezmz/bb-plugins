// The list store's one derive step: from everything the list is built from,
// the list model, with today's pure functions in today's order. Pure: what
// it remembers between steps goes in and comes out as `memory`.
import type {
  PluginEnvironmentProvider,
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarSplitLayout,
  PluginSidebarThread,
  PluginSidebarThreadsState,
  PluginProvidersState,
} from "@get-bb/plugin-sdk/app";
import type { Stamps, ThreadNotes } from "@/shared/contract";
import type { ClientPreferences, Preferences } from "@/shared/preferences";
import { detectTransitions, mergeTargets, snapshotOf, type Snapshot, type Targets } from "../model/expansion";
import { groupIdForRoot } from "../model/groups";
import { providerDisplays, type ProviderDisplay } from "../model/provider-mark";
import { holdSettled, type SettleHold, type SettleInputs } from "../model/settled";
import { share, shareView } from "../model/share";
import { miniMapsOf, openThreadIdsOf, type MiniMapPane } from "../model/split";
import { buildForest, type Forest, type ThreadInfo } from "../model/trees";
import { buildListView, countNeedYou, needYouActive, type GroupView, type ListView } from "../model/view";

/** What bb's list hooks hand the list. */
export interface HostData {
  status: PluginSidebarThreadsState["status"];
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  sections: readonly PluginSidebarSection[];
  archived: PluginSidebarThreadsState["experimental_archived"];
  providers: PluginProvidersState["providers"];
  environmentProviders: readonly PluginEnvironmentProvider[];
  draftIds: ReadonlySet<string>;
  splitLayout: PluginSidebarSplitLayout | null;
}

export const NO_HOST: HostData = {
  status: "loading",
  threads: [],
  projects: [],
  sections: [],
  archived: null,
  providers: [],
  environmentProviders: [],
  draftIds: new Set(),
  splitLayout: null,
};

/** What `system.config()` says: bb's default harness and primary machine, null until answered. */
export interface SystemFacts {
  defaultProviderId: string | null;
  primaryHostId: string | null;
}

/** Project id → default branch; absent while unknown, null when the lookup found none. */
export type DefaultBranches = ReadonlyMap<string, string | null>;

/** Everything the list model is built from. */
export interface ListInputs {
  host: HostData;
  activeThreadId: string | null;
  stamps: Stamps;
  /** The first listing of stamps came back, or failed. */
  stampsLoaded: boolean;
  notes: Readonly<Record<string, ThreadNotes>>;
  scheduled: Readonly<Record<string, number>>;
  prefs: Preferences;
  /** The server's preferences have arrived (or failed; the mirror stands in). */
  hydrated: boolean;
  client: ClientPreferences;
  system: SystemFacts;
  defaultBranches: DefaultBranches;
  /** The list's clock. */
  now: number;
  /** When this list saw each thread go from busy to idle (see `trackIdle`). */
  idleSince: Readonly<Record<string, number>>;
  /** The need-you filter, per window, off on every load. */
  needYouOn: boolean;
  /** Transient auto-expansion. */
  targets: Targets;
}

/** The list model: what rows, group headers and the list header draw. */
export interface ListModel {
  forest: Forest;
  view: ListView;
  byId: ReadonlyMap<string, PluginSidebarThread>;
  /** Shown groups' ids in order, then hidden ones', each the same array while unchanged. */
  groupIds: readonly string[];
  moreIds: readonly string[];
  groupsById: ReadonlyMap<string, GroupView>;
  /** The group holding the focused thread: on phones only it shows `+`. */
  activeGroupId: string | null;
  providerDisplay(providerId: string): ProviderDisplay;
  /** Every thread a split pane shows. */
  openThreadIds: ReadonlySet<string>;
  /** Each open thread's split mini-map. */
  miniMaps: ReadonlyMap<string, readonly MiniMapPane[]>;
  /** Projects with a thread on a branch: the rest need no default branch. */
  branchedProjectIds: readonly string[];
  /** The next moment the list changes without an event: a scheduled send, or a failure becoming orphaned. */
  nextDeadline: number | null;
}

/** What one step leaves for the next. */
export interface DeriveMemory {
  snapshot: Snapshot | null;
  hold: SettleHold | null;
  model: ListModel | null;
  /** The focused thread the last step saw; undefined before the first. */
  activeThreadId: string | null | undefined;
  providers: HostData["providers"] | null;
  providerDisplay: ((providerId: string) => ProviderDisplay) | null;
  /** The threads and split layout the last model was built from. */
  threads: HostData["threads"] | null;
  splitLayout: PluginSidebarSplitLayout | null;
}

export const FIRST_STEP: DeriveMemory = {
  snapshot: null,
  hold: null,
  model: null,
  activeThreadId: undefined,
  providers: null,
  providerDisplay: null,
  threads: null,
  splitLayout: null,
};

export interface Derived {
  /** The inputs, with what the rules changed: seen stamps, targets, the filter. */
  inputs: ListInputs;
  model: ListModel | null;
  memory: DeriveMemory;
  /** Child threads to mark seen on the server, the focused thread having changed. */
  seen: string[];
}

/**
 * Viewing a child stamps seenAt, on arrival and on leaving, so a child that
 * finishes while you watch doesn't turn unread behind you.
 */
function seenOnFocus(inputs: ListInputs, previous: string | null | undefined): string[] {
  if (previous === inputs.activeThreadId) return [];
  const parentOf = (id: string) => inputs.host.threads.find((thread) => thread.id === id)?.parentThreadId ?? null;
  const ids = [previous ?? null, inputs.activeThreadId].filter((id): id is string => id !== null && parentOf(id) !== null);
  return [...new Set(ids)];
}

function withSeen(stamps: Stamps, ids: readonly string[], at: number): Stamps {
  if (ids.length === 0) return stamps;
  const seenAt = { ...stamps.seenAt };
  for (const id of ids) seenAt[id] = at;
  return { ...stamps, seenAt };
}

/**
 * One step: marks seen, then when each thread went idle (already in
 * `idleSince`), the forest, auto-expansion, the need-you filter, the Held
 * tree and the list view, shared with the last step's. `at` is the moment of
 * the step, for seen stamps.
 */
export function derive(given: ListInputs, memory: DeriveMemory, at: number): Derived {
  const seen = seenOnFocus(given, memory.activeThreadId);
  let inputs: ListInputs = seen.length === 0 ? given : { ...given, stamps: withSeen(given.stamps, seen, at) };
  const next: DeriveMemory = { ...memory, activeThreadId: inputs.activeThreadId };
  const { host, prefs, stamps } = inputs;
  if (host.status !== "ready") return { inputs, model: null, memory: { ...next, model: null }, seen };

  const splitLayout = host.splitLayout;
  const sameLayout = memory.model !== null && memory.splitLayout === splitLayout;
  const openThreadIds = sameLayout ? memory.model!.openThreadIds : openThreadIdsOf(splitLayout);
  const forest = buildForest({
    threads: host.threads,
    activeThreadId: inputs.activeThreadId,
    openThreadIds,
    finishedAt: stamps.finishedAt,
    seenAt: stamps.seenAt,
    draftIds: host.draftIds,
    scheduled: inputs.scheduled,
    now: inputs.now,
    notes: inputs.notes,
    childAttention: prefs.childAttention,
    idleSince: inputs.idleSince,
    idleAt: stamps.idleAt,
    stampsLoaded: inputs.stampsLoaded,
  });

  // Auto-expansion, diffed against the last step, once the preferences are in.
  if (inputs.hydrated) {
    const snapshot = snapshotOf(forest, inputs.activeThreadId);
    const targets = mergeTargets(inputs.targets, detectTransitions(memory.snapshot, snapshot));
    next.snapshot = snapshot;
    if (targets !== inputs.targets) inputs = { ...inputs, targets };
  }

  // Nothing left that needs you turns the filter off, so it does not narrow
  // the list again unasked when something next does.
  const needYouCount = countNeedYou(forest);
  if (inputs.needYouOn && !needYouActive(true, needYouCount)) inputs = { ...inputs, needYouOn: false };

  const settle: SettleInputs = {
    now: inputs.now,
    settleAfter: prefs.settleAfter,
    startedAt: stamps.startedAt,
    finishedAt: stamps.finishedAt,
  };
  const groupOf = (root: ThreadInfo) => groupIdForRoot(root.thread, { mode: prefs.organizationMode, projects: host.projects });
  // Each step's hold reads the last one's, so a tree that settles while
  // focused knows it was not settled before.
  const hold = holdSettled(memory.hold, forest.trees, settle, groupOf);
  next.hold = hold;

  const defaultBranches = inputs.defaultBranches;
  const previous = memory.model;
  const view = shareView(
    previous?.view ?? null,
    buildListView({
      forest,
      threads: host.threads,
      projects: host.projects,
      sections: host.sections,
      prefs,
      activeThreadId: inputs.activeThreadId,
      targets: inputs.targets,
      settle,
      held: hold.held,
      defaultProviderId: inputs.system.defaultProviderId,
      primaryHostId: inputs.system.primaryHostId,
      showBranchLine: inputs.client.branchLine,
      defaultBranchOf: (thread) => (defaultBranches.has(thread.projectId) ? (defaultBranches.get(thread.projectId) ?? null) : undefined),
      needYouOnly: needYouActive(inputs.needYouOn, needYouCount),
      pendingAt: stamps.pendingAt,
    }),
  );

  if (memory.providers !== host.providers || memory.providerDisplay === null) {
    next.providers = host.providers;
    next.providerDisplay = providerDisplays(host.providers);
  }

  const futureSends = Object.values(inputs.scheduled).filter((sendAt) => sendAt > inputs.now);
  const deadlines = forest.nextOrphanAt === null ? futureSends : [...futureSends, forest.nextOrphanAt];
  const activeTree = inputs.activeThreadId === null ? undefined : forest.treeOf.get(inputs.activeThreadId);
  const groupIds = view.groups.map((group) => group.descriptor.id);
  const moreIds = view.more.map((group) => group.descriptor.id);
  const sameThreads = previous !== null && memory.threads === host.threads;
  const model: ListModel = {
    forest,
    view,
    byId: sameThreads ? previous.byId : new Map(host.threads.map((thread) => [thread.id, thread])),
    groupIds: previous === null ? groupIds : share(previous.groupIds, groupIds),
    moreIds: previous === null ? moreIds : share(previous.moreIds, moreIds),
    groupsById: new Map([...view.groups, ...view.more].map((group) => [group.descriptor.id, group])),
    activeGroupId: activeTree === undefined ? null : groupOf(activeTree.root),
    providerDisplay: next.providerDisplay!,
    openThreadIds,
    miniMaps: sameLayout ? previous!.miniMaps : miniMapsOf(splitLayout, previous?.miniMaps ?? new Map()),
    branchedProjectIds: sameThreads
      ? previous.branchedProjectIds
      : share(previous?.branchedProjectIds ?? [], branchedProjectIdsOf(host.threads)),
    nextDeadline: deadlines.length > 0 ? Math.min(...deadlines) : null,
  };
  next.model = model;
  next.threads = host.threads;
  next.splitLayout = splitLayout;
  return { inputs, model, memory: next, seen };
}

function branchedProjectIdsOf(threads: readonly PluginSidebarThread[]): string[] {
  return [...new Set(threads.flatMap((thread) => (thread.environment?.branchName ? [thread.projectId] : [])))];
}
