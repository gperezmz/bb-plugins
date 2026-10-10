// A thread as bb's thread actions and menus read it. Pure.
import type { PluginSidebarThread, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";

export function actionTargetOf(thread: PluginSidebarThread): PluginThreadActionTarget {
  const { environment } = thread;
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: environment?.id != null ? { id: environment.id, path: environment.path } : null,
  };
}
