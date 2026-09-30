// A real list for the jsdom run: `bb thread list --json` and `bb project list
// --json` output, read into what bb's sidebar hook reports.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makeThread, type GeneratedList } from "@/features/thread-list/testing/fixtures";

interface CliThread {
  id: string;
  projectId: string;
  environmentId: string | null;
  providerId: string;
  title: string | null;
  titleFallback: string | null;
  sectionId: string | null;
  status: string;
  parentThreadId: string | null;
  visibility: string;
  archivedAt: number | null;
  pinnedAt: number | null;
  lastReadAt: number | null;
  latestAttentionAt: number;
  createdAt: number;
  updatedAt: number;
  environmentBranchName: string | null;
  environmentHostId: string | null;
  environmentName: string | null;
  environmentPath: string | null;
  environmentProviderId: string | null;
  environmentIsWorktree: boolean;
  hasPendingInteraction: boolean;
  runtime: { displayStatus: string };
}

function toSidebarThread(raw: CliThread): PluginSidebarThread {
  const title = raw.title ?? raw.titleFallback ?? "Untitled";
  return makeThread({
    id: raw.id,
    projectId: raw.projectId,
    title,
    displayTitle: title,
    providerId: raw.providerId,
    sectionId: raw.sectionId,
    status: raw.status as PluginSidebarThread["status"],
    runtimeStatus: raw.runtime.displayStatus as PluginSidebarThread["runtimeStatus"],
    parentThreadId: raw.parentThreadId,
    isHidden: raw.visibility === "hidden",
    isArchived: raw.archivedAt !== null,
    archivedAt: raw.archivedAt,
    isPinned: raw.pinnedAt !== null,
    pinnedAt: raw.pinnedAt,
    lastReadAt: raw.lastReadAt ?? 0,
    isUnread: (raw.lastReadAt ?? 0) < raw.latestAttentionAt,
    latestAttentionAt: raw.latestAttentionAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    hasPendingInteraction: raw.hasPendingInteraction,
    host: raw.environmentHostId ? { id: raw.environmentHostId, name: raw.environmentHostId } : null,
    environment:
      raw.environmentId === null
        ? null
        : {
            id: raw.environmentId,
            name: raw.environmentName,
            branchName: raw.environmentBranchName,
            path: raw.environmentPath,
            isWorktree: raw.environmentIsWorktree,
            providerId: raw.environmentProviderId,
          },
  });
}

/** A snapshot as a list the harness mounts, at the snapshot's own latest moment. */
export function snapshotList(threads: CliThread[], projects: { id: string; name: string }[]): GeneratedList {
  const sidebar = threads.map(toSidebarThread);
  const sidebarProjects: PluginSidebarProject[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    isPersonal: false,
    href: `/projects/${project.id}`,
    settingsHref: `/projects/${project.id}/settings`,
  }));
  return {
    threads: sidebar,
    projects: sidebarProjects,
    now: Math.max(...sidebar.map((thread) => thread.updatedAt)) + 60_000,
    unreadIds: sidebar.filter((thread) => thread.isUnread).map((thread) => thread.id),
  };
}
