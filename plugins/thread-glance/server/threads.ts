// The server's view of bb's threads: the data the shelf rules read, and the
// calls the lifecycle actions make on bb. `ThreadGateway` is the port; the
// SDK adapter is the only code here that names `bb.sdk`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ShelfThread } from "../shared/lifecycle";

type Sdk = BbPluginApi["sdk"];
type ListedThread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];

const PAGE_SIZE = 500;

/** A thread as the server reads it: the shelf rules' input plus what the actions need. */
export interface ServerThread extends ShelfThread {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  /** The environment the thread works in; null before one is attached. */
  environmentId: string | null;
  /** bb's pin order key, null for a pin never reordered. */
  pinSortKey: string | null;
  pinnedAt: number | null;
  /** The title for messages: title, else fallback, else "Untitled thread". */
  title: string;
  /** Hidden threads are bb's internal helpers; no list shows them. */
  hidden: boolean;
  archived: boolean;
}

export interface ThreadGateway {
  /** Every thread bb has that is not archived or deleted, hidden ones included, as bb reports them now. */
  snapshot(): Promise<ServerThread[]>;
  /** The ids of archived threads. */
  archivedIds(): Promise<Set<string>>;
  pin(threadId: string): Promise<void>;
  unpin(threadId: string): Promise<void>;
  /** Puts a pinned thread between two pinned threads in bb's pin order; null is an end. */
  reorderPinned(threadId: string, previousThreadId: string | null, nextThreadId: string | null): Promise<void>;
  /** The thread's parent id, or undefined when bb no longer has the thread (a deleted thread). */
  parentOf(threadId: string): Promise<string | null | undefined>;
}

/** The pinned threads in the order bb lists them: by pin key, then newest pin first. */
export function pinnedInOrder(threads: readonly ServerThread[]): ServerThread[] {
  return threads
    .filter((thread) => thread.pinnedAt !== null)
    .sort((a, b) => {
      if (a.pinSortKey !== null && b.pinSortKey !== null) return a.pinSortKey < b.pinSortKey ? -1 : a.pinSortKey > b.pinSortKey ? 1 : 0;
      if (a.pinSortKey !== null) return -1;
      if (b.pinSortKey !== null) return 1;
      return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
    });
}

/** A listed thread mapped onto the shelf rules' input. */
export function toServerThread(thread: ListedThread): ServerThread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    environmentId: thread.environmentId,
    pinSortKey: thread.pinSortKey,
    pinnedAt: thread.pinnedAt,
    isPinned: thread.pinnedAt !== null,
    title: thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread",
    hidden: thread.visibility === "hidden",
    archived: thread.archivedAt !== null,
    hasPendingInteraction: thread.hasPendingInteraction,
    queuedWork: thread.queuedWork,
    status: thread.status,
    runtimeStatus: thread.runtime.displayStatus,
    activity: {
      workflows: thread.activity.activeWorkflowCount,
      backgroundAgents: thread.activity.activeBackgroundAgentCount,
      backgroundCommands: thread.activity.activeBackgroundCommandCount,
      planMode: thread.activity.activePlanModeCount,
      goals: thread.activity.activeGoalCount,
    },
    latestAttentionAt: thread.latestAttentionAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

/** Pages through a thread listing; bb caps a page, so a short page does not end it, an empty one does. */
async function listAll(sdk: Sdk, archived: boolean): Promise<ListedThread[]> {
  const byId = new Map<string, ListedThread>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await sdk.threads.list({ archived, includeHidden: true, limit: PAGE_SIZE, offset });
    if (page.length === 0) break;
    for (const thread of page) byId.set(thread.id, thread);
  }
  return [...byId.values()];
}

export function createSdkThreads(bb: Pick<BbPluginApi, "sdk">): ThreadGateway {
  return {
    async snapshot() {
      const listed = await listAll(bb.sdk, false);
      return listed.filter((thread) => thread.archivedAt === null && thread.deletedAt === null).map(toServerThread);
    },
    async archivedIds() {
      return new Set((await listAll(bb.sdk, true)).map((thread) => thread.id));
    },
    async pin(threadId) {
      await bb.sdk.threads.pin({ threadId });
    },
    async unpin(threadId) {
      await bb.sdk.threads.unpin({ threadId });
    },
    async reorderPinned(threadId, previousThreadId, nextThreadId) {
      await bb.sdk.threads.reorderPinned({ threadId, previousThreadId, nextThreadId });
    },
    async parentOf(threadId) {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        return thread.deletedAt !== null ? undefined : thread.parentThreadId;
      } catch {
        return undefined;
      }
    },
  };
}
