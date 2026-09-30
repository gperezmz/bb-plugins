// Test fixtures: sidebar threads, projects and a ready-made view builder.
import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
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
  notes?: Record<string, import("@/shared/contract").ThreadNotes>;
  now?: number;
  startedAt?: Record<string, number>;
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

/** The two lists the performance harness measures: nothing settled yet, or two days on. */
export type GeneratedScenario = "live" | "settled";

export interface GeneratedList {
  threads: PluginSidebarThread[];
  projects: PluginSidebarProject[];
  /** The clock the list is mounted at. */
  now: number;
  /** Threads bb reports unread, in list order. */
  unreadIds: string[];
}

export interface GenerateOptions {
  /** Threads in the list. */
  size: number;
  scenario?: GeneratedScenario;
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
export const GENERATED_PROJECTS: PluginSidebarProject[] = [1, 2, 3, 4].map((index) =>
  makeProject(`proj_${index}`, `Project ${index}`),
);

/**
 * A list shaped like the seeded bb the audit measured: two thirds top-level
 * threads, five child threads per parent thread, four groups and about 95 %
 * read. Every thread's last activity falls in the day before T0, so nothing
 * is settled at T0 ("live"), and every read, idle tree is settled two days on
 * ("settled").
 */
export function generateList({ size, scenario = "live", unread, seed = 145 }: GenerateOptions): GeneratedList {
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
    now: scenario === "live" ? T0 + 60_000 : T0 + 2 * DAY,
    unreadIds: threads.filter((thread) => thread.isUnread).map((thread) => thread.id),
  };
}

/** The Mark all read list: 1,500 threads, 443 of them unread. */
export function markAllReadList(seed = 145): GeneratedList {
  return generateList({ size: 1_500, unread: 443, seed });
}
