// Test fixtures: sidebar threads and projects.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

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
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0, ...activity },
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

/** Fields of a thread that is working. */
export const working = { status: "active", runtimeStatus: "active" } as const;

export function makeProject(id: string, name = id, overrides: Partial<PluginSidebarProject> = {}): PluginSidebarProject {
  return { id, name, isPersonal: false, href: `/projects/${id}`, settingsHref: `/projects/${id}/settings`, ...overrides };
}

export const PROJECTS: PluginSidebarProject[] = [
  makeProject("proj_personal", "Personal", { isPersonal: true }),
  makeProject("proj_a", "Alpha"),
  makeProject("proj_b", "Beta"),
];

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** The title a row draws, whatever else its card shows. */
export function titleOf(card: Element): string {
  return card.querySelector("[data-title]")?.textContent?.trim() ?? "";
}
