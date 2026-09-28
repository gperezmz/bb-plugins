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
import { pullRequestFact, type PullRequestState, type SettleInputs } from "../model/settled";

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
  targets?: Targets;
  finishedAt?: Record<string, number>;
  seenAt?: Record<string, number>;
  scheduled?: Record<string, number>;
  draftIds?: string[];
  notes?: Record<string, import("@/shared/contract").ThreadNotes>;
  now?: number;
  startedAt?: Record<string, number>;
  /** Project id → default branch; "main" for every project when absent. */
  defaultBranches?: Record<string, string | null>;
  /** bb's default harness; "claude-code", the fixtures' own, when absent. */
  defaultProviderId?: string | null;
  /** Pull request lookups that answered, by thread id. */
  pullRequests?: Record<string, PullRequestState | null>;
}

export function forestOf(scenario: Scenario): Forest {
  return buildForest({
    threads: scenario.threads,
    activeThreadId: scenario.activeThreadId ?? null,
    finishedAt: scenario.finishedAt ?? {},
    seenAt: scenario.seenAt ?? {},
    scheduled: scenario.scheduled ?? {},
    draftIds: new Set(scenario.draftIds ?? []),
    notes: scenario.notes ?? {},
    childAttention: scenario.prefs?.childAttention,
    now: scenario.now ?? T0 + 60_000,
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
    defaultProviderId: scenario.defaultProviderId === undefined ? "claude-code" : scenario.defaultProviderId,
  });
}

/** The settle inputs a scenario stands for. */
export function settleOf(scenario: Scenario): SettleInputs {
  const answers = new Map(Object.entries(scenario.pullRequests ?? {}));
  const defaultBranchOf = (projectId: string) =>
    scenario.defaultBranches === undefined ? "main" : scenario.defaultBranches[projectId];
  return {
    now: scenario.now ?? T0 + 60_000,
    settleAfter: scenario.prefs?.settleAfter ?? defaultPreferences().settleAfter,
    startedAt: scenario.startedAt ?? {},
    finishedAt: scenario.finishedAt ?? {},
    pullRequestOf: (thread) => pullRequestFact(thread, defaultBranchOf(thread.projectId), answers),
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
