// Fakes for the server's ports: an in-memory bb thread list and a real
// in-memory SQLite database for the stores.
import BetterSqlite3 from "better-sqlite3";
import type { Database } from "../database";
import { MIGRATIONS } from "../database";
import type { PullRequests, PullRequestStatus } from "../pull-requests";
import type { RuntimeTerminal, ThreadRuntime } from "../runtime";
import type { ServerThread, ThreadGateway } from "../threads";

/** An idle, visible, unpinned thread; override what a test cares about. */
export function makeServerThread(id: string, overrides: Partial<ServerThread> = {}): ServerThread {
  return {
    id,
    projectId: "project-1",
    parentThreadId: null,
    environmentId: null,
    pinSortKey: null,
    pinnedAt: null,
    isPinned: false,
    title: `Thread ${id}`,
    hidden: false,
    archived: false,
    hasPendingInteraction: false,
    queuedWork: "none",
    status: "idle",
    runtimeStatus: "idle",
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    latestAttentionAt: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

export function pinned(thread: ServerThread, pinnedAt = 5_000, pinSortKey: string | null = null): ServerThread {
  return { ...thread, isPinned: true, pinnedAt, pinSortKey };
}

/** A migrated database in memory. */
export function memoryDatabase(): Database {
  const db = new BetterSqlite3(":memory:");
  db.transaction(() => {
    for (const statement of MIGRATIONS) db.exec(statement);
  })();
  return db as unknown as Database;
}

export interface FakeThreads extends ThreadGateway {
  threads: Map<string, ServerThread>;
  archived: Set<string>;
  /** Calls to pin, unpin and reorderPinned, in order. */
  calls: string[];
  /** Runs before the nth `snapshot` call (1-based); lets a test change bb between two reads. */
  beforeSnapshot: ((call: number) => void) | null;
  snapshots: number;
  /** Makes `unpin` fail for these ids. */
  failUnpin: Set<string>;
}

export function createFakeThreads(initial: readonly ServerThread[] = []): FakeThreads {
  const fake: FakeThreads = {
    threads: new Map(initial.map((thread) => [thread.id, thread])),
    archived: new Set(),
    calls: [],
    beforeSnapshot: null,
    snapshots: 0,
    failUnpin: new Set(),
    async snapshot() {
      fake.snapshots += 1;
      fake.beforeSnapshot?.(fake.snapshots);
      return [...fake.threads.values()].map((thread) => ({ ...thread }));
    },
    async archivedIds() {
      return new Set(fake.archived);
    },
    async pin(threadId) {
      fake.calls.push(`pin ${threadId}`);
      const thread = fake.threads.get(threadId);
      if (thread) fake.threads.set(threadId, pinned(thread));
    },
    async unpin(threadId) {
      fake.calls.push(`unpin ${threadId}`);
      if (fake.failUnpin.has(threadId)) throw new Error("bb refused");
      const thread = fake.threads.get(threadId);
      if (thread) fake.threads.set(threadId, { ...thread, isPinned: false, pinnedAt: null, pinSortKey: null });
    },
    async reorderPinned(threadId, previousThreadId, nextThreadId) {
      fake.calls.push(`reorder ${threadId} ${previousThreadId} ${nextThreadId}`);
    },
    async find(threadId) {
      const thread = fake.threads.get(threadId);
      return thread === undefined ? undefined : { ...thread };
    },
    async parentOf(threadId) {
      const thread = fake.threads.get(threadId);
      return thread === undefined ? undefined : thread.parentThreadId;
    },
  };
  return fake;
}

type ListedThread = Awaited<ReturnType<import("@get-bb/plugin-sdk").BbPluginApi["sdk"]["threads"]["list"]>>[number];

/** A thread as `bb.sdk.threads.list` returns it: idle, visible, unpinned; override what a test cares about. */
export function listedThread(id: string, overrides: Partial<ListedThread> = {}): ListedThread {
  return {
    activity: {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activeWorkflowCount: 0,
    },
    archivedAt: null,
    createdAt: 1_000,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentIsWorktree: null,
    environmentName: null,
    environmentPath: null,
    environmentProviderId: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id,
    lastReadAt: null,
    latestAttentionAt: 1_000,
    lifecycleOwnerThreadId: null,
    originKind: null,
    originPluginId: null,
    parentThreadId: null,
    pinSortKey: null,
    pinnedAt: null,
    projectId: "project-1",
    providerId: "claude-code",
    queuedWork: "none",
    runtime: { displayStatus: "idle" },
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title: `Thread ${id}`,
    titleFallback: null,
    updatedAt: 1_000,
    visibility: "visible",
    ...overrides,
  };
}

/**
 * `bb.sdk` stubs for a fake host whose bb holds `threads` (a function, so a
 * test can change them) and `archived`: the listing pages the way bb does, and
 * pin, unpin and reorder change the list.
 */
export function sdkWith(
  threads: () => ListedThread[],
  archived: () => ListedThread[] = () => [],
  extra: { threads?: Record<string, unknown> } & Record<string, unknown> = {},
) {
  const { threads: extraThreads, ...otherAreas } = extra;
  return {
    ...otherAreas,
    threads: {
      async list({ archived: wantArchived, offset }: { archived?: boolean; offset?: number } = {}) {
        return offset ? [] : wantArchived ? archived() : threads();
      },
      async get({ threadId }: { threadId: string }) {
        const thread = [...threads(), ...archived()].find((candidate) => candidate.id === threadId);
        if (thread === undefined) throw new Error("not found");
        return thread;
      },
      async pin() {},
      async unpin({ threadId }: { threadId: string }) {
        const thread = threads().find((candidate) => candidate.id === threadId);
        if (thread) Object.assign(thread, { pinnedAt: null, pinSortKey: null });
      },
      async reorderPinned() {
        return [];
      },
      ...extraThreads,
    },
  } as never;
}

export interface FakeRuntime extends ThreadRuntime {
  /** Thread ids whose runtime was stopped, in order. */
  stopped: string[];
  /** Ids of the terminals that were closed, in order. */
  closed: string[];
  terminalsByThread: Map<string, RuntimeTerminal[]>;
  /** Runs before each call, named like the call and its argument; lets a test change bb between two steps. */
  onCall: ((call: string) => void) | null;
  failStop: Set<string>;
}

/** A thread runtime that records what it was asked and holds terminals per thread. */
export function createFakeRuntime(terminalsByThread: Record<string, RuntimeTerminal[]> = {}): FakeRuntime {
  const fake: FakeRuntime = {
    stopped: [],
    closed: [],
    terminalsByThread: new Map(Object.entries(terminalsByThread)),
    onCall: null,
    failStop: new Set(),
    async stop(threadId) {
      fake.onCall?.(`stop ${threadId}`);
      if (fake.failStop.has(threadId)) throw new Error("bb refused");
      fake.stopped.push(threadId);
    },
    async terminals(threadId) {
      fake.onCall?.(`terminals ${threadId}`);
      return (fake.terminalsByThread.get(threadId) ?? []).map((terminal) => ({ ...terminal }));
    },
    async terminal(terminalId) {
      fake.onCall?.(`terminal ${terminalId}`);
      for (const terminals of fake.terminalsByThread.values()) {
        const found = terminals.find((terminal) => terminal.id === terminalId);
        if (found) return { ...found };
      }
      return undefined;
    },
    async closeIfUntouched(terminalId) {
      fake.onCall?.(`close ${terminalId}`);
      for (const [threadId, terminals] of fake.terminalsByThread) {
        const found = terminals.find((terminal) => terminal.id === terminalId);
        if (!found) continue;
        if (found.lastUserInputAt !== null) return false;
        fake.terminalsByThread.set(threadId, terminals.filter((terminal) => terminal.id !== terminalId));
        fake.closed.push(terminalId);
        return true;
      }
      return false;
    },
  };
  return fake;
}

export function terminal(id: string, overrides: Partial<RuntimeTerminal> = {}): RuntimeTerminal {
  return { id, status: "running", lastUserInputAt: null, ...overrides };
}

/** Pull requests by environment id; an environment not listed has none. */
export function createFakePullRequests(byEnvironment: Record<string, PullRequestStatus> = {}): PullRequests & {
  reads: string[];
  byEnvironment: Record<string, PullRequestStatus>;
} {
  const fake = {
    reads: [] as string[],
    byEnvironment,
    async read(environmentId: string): Promise<PullRequestStatus> {
      fake.reads.push(environmentId);
      return fake.byEnvironment[environmentId] ?? { kind: "absent" };
    },
  };
  return fake;
}
