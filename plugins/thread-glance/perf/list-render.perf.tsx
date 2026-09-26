// @vitest-environment jsdom
// Opt-in render benchmark (`npm run perf`): mounts the list over a real
// `bb thread list --json` snapshot and times one event at a time, counting
// commits and component renders per event. Not part of `npm test`; skipped
// unless PERF_THREADS names a snapshot:
//   bb thread list --json --include-hidden > threads.json
//   bb project list --json > projects.json
//   PERF_THREADS=threads.json PERF_PROJECTS=projects.json PERF_OUT=out.json npm run perf
import { Profiler, memo, useSyncExternalStore, type ComponentType } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarProject, PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { defaultPreferences, type Preferences } from "@/shared/preferences";
import { CHANNELS } from "@/shared/contract";
import { makeThread } from "@/features/thread-list/testing/fixtures";

const counts = { row: 0, group: 0, older: 0, environment: 0 };

vi.mock("@/features/thread-list/components/ThreadRowView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/thread-list/components/ThreadRowView")>();
  const inner = (actual.ThreadRowView as unknown as { type: ComponentType<never> }).type as (props: never) => unknown;
  const compare = (actual.ThreadRowView as unknown as { compare: null | ((a: unknown, b: unknown) => boolean) }).compare;
  const Counting = (props: never) => {
    counts.row += 1;
    return inner(props) as React.ReactNode;
  };
  return { ...actual, ThreadRowView: memo(Counting, compare ?? undefined) };
});
vi.mock("@/features/thread-list/components/FoldRows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/thread-list/components/FoldRows")>();
  const wrap = (component: unknown, key: "older" | "environment") => {
    const memoType = (component as { type?: (props: never) => unknown; compare?: ((a: unknown, b: unknown) => boolean) | null });
    const inner = (memoType.type ?? component) as (props: never) => unknown;
    const Counting = (props: never) => {
      counts[key] += 1;
      return inner(props) as React.ReactNode;
    };
    return memoType.type ? memo(Counting, memoType.compare ?? undefined) : Counting;
  };
  return {
    ...actual,
    OlderRowView: wrap(actual.OlderRowView, "older"),
    EnvironmentRowView: wrap(actual.EnvironmentRowView, "environment"),
  };
});
vi.mock("@/features/thread-list/components/GroupSection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/thread-list/components/GroupSection")>();
  const memoType = actual.GroupSection as unknown as { type: (props: never) => unknown; compare: ((a: unknown, b: unknown) => boolean) | null };
  const Counting = (props: never) => {
    counts.group += 1;
    return memoType.type(props) as React.ReactNode;
  };
  return { ...actual, GroupSection: memo(Counting, memoType.compare ?? undefined) };
});

// The host's sidebar threads and the list's props, from stores the test drives.
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
const threadsStore = store<PluginSidebarThread[]>([]);
const activeStore = store<string | null>(null);
let projects: PluginSidebarProject[] = [];

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  const empty = { status: "ready", threads: [], projects: [], sections: [], experimental_archived: null };
  return {
    ...actual,
    experimental_useSidebarThreads: () => {
      const threads = useSyncExternalStore(threadsStore.subscribe, threadsStore.get);
      // One object per threads array, as the host's query cache hands out.
      return useMemoOnce(threads);
    },
  };
  function useMemoOnce(threads: PluginSidebarThread[]) {
    const cached = sidebarCache.get(threads);
    if (cached) return cached;
    const value = { ...empty, threads, projects };
    sidebarCache.set(threads, value);
    return value;
  }
});
const sidebarCache = new WeakMap<object, unknown>();

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
  queuedWork: string;
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

const SNAPSHOT = process.env.PERF_THREADS;
const PROJECTS_SNAPSHOT = process.env.PERF_PROJECTS;
const OUT = process.env.PERF_OUT;
const RUNS = Number(process.env.PERF_RUNS ?? 20);

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  app = await loadPluginApp(() => import("../app"));
});

interface Sample {
  wallMs: number;
  profilerMs: number;
  commits: number;
  rows: number;
  groups: number;
  older: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const SCENARIOS: Record<string, Partial<Preferences>> = {
  // Every thread drawn: archived shown, nothing collapsed or folded.
  "all-expanded": {
    threadLifecycles: ["active", "archived"],
    foldOlder: false,
    collapsedSections: [],
    collapsedProjects: [],
  },
  // A typical folded layout, archived shown.
  "folded-archived": {
    threadLifecycles: ["active", "archived"],
    organizationMode: "project",
    foldOlder: true,
    collapsedSections: ["threads"],
    collapsedProjects: [],
    expandedChildren: [],
  },
};

describe.skipIf(!SNAPSHOT)("list render cost over a real snapshot", () => {
  it("measures one event at a time", async () => {
    const raw = JSON.parse(readFileSync(SNAPSHOT!, "utf8")) as CliThread[];
    const rawProjects = PROJECTS_SNAPSHOT
      ? (JSON.parse(readFileSync(PROJECTS_SNAPSHOT, "utf8")) as { id: string; name: string }[])
      : [];
    projects = rawProjects.map((project) => ({
      id: project.id,
      name: project.name,
      isPersonal: false,
      href: `/projects/${project.id}`,
      settingsHref: `/projects/${project.id}/settings`,
    }));
    const base = raw.map(toSidebarThread);
    const results: Record<string, Record<string, unknown>> = {};

    for (const [scenario, prefs] of Object.entries(SCENARIOS)) {
      threadsStore.set(base);
      activeStore.set(null);
      let profilerMs = 0;
      let commits = 0;
      const Inner = app.threadLists[0]!.component as ComponentType<PluginThreadListProps>;
      const Wrapped = (props: PluginThreadListProps) => {
        const activeThreadId = useSyncExternalStore(activeStore.subscribe, activeStore.get);
        return (
          <Profiler
            id="list"
            onRender={(_id, _phase, actual) => {
              profilerMs += actual;
              commits += 1;
            }}
          >
            <Inner {...props} activeThreadId={activeThreadId} />
          </Profiler>
        );
      };
      const preferences = { ...defaultPreferences(), ...prefs };
      const slot = renderSlot(
        { component: Wrapped },
        { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate() {}, searchQuery: "" },
        {
          rpc: {
            listPreferences: () => ({ preferences }),
            setPreference: ({ key, value }: { key: string; value: unknown }) => ({ key, value }),
            resetPreference: ({ key }: { key: string }) => ({ key, value: null }),
            importPreferences: () => ({ status: "already-imported" as const, source: null, keys: [] }),
            listStamps: () => ({ stamps: { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {} } }),
            markSeen: () => ({ at: Date.now() }),
            clearSeen: () => ({ ok: true as const }),
            listScheduled: () => ({ status: "ready" as const, scheduled: {} }),
            listNotes: () => ({ notes: {} }),
          } as never,
          providers: {
            status: "ready",
            providers: [
              { id: "claude-code", displayName: "Claude Code", logoUrl: null },
              { id: "codex", displayName: "Codex", logoUrl: null },
              { id: "pi", displayName: "Pi", logoUrl: null },
            ] as never,
          },
          sdk: {
            threads: { defaultExecutionOptions: async () => null, update: async () => ({}) } as never,
            projects: { branches: async () => ({ defaultBranch: "main" }) } as never,
            providers: { models: async () => ({ models: [] }) } as never,
          },
        },
      );
      // Settle the initial loads.
      for (let index = 0; index < 5; index += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      const mountedRows = document.querySelectorAll("[data-sidebar-thread-id]").length;
      expect(mountedRows).toBeGreaterThan(0);

      // A visible, unarchived root the events act on.
      const target =
        base.find((thread) => !thread.isArchived && thread.parentThreadId === null && !thread.isHidden && thread.status === "idle") ??
        base[0]!;
      const other = base.find((thread) => thread.id !== target.id && !thread.isArchived && !thread.isHidden) ?? base[1]!;

      const measure = async (run: (index: number) => Promise<void> | void): Promise<Sample[]> => {
        const samples: Sample[] = [];
        for (let index = 0; index < RUNS; index += 1) {
          counts.row = 0;
          counts.group = 0;
          counts.older = 0;
          counts.environment = 0;
          profilerMs = 0;
          commits = 0;
          const start = performance.now();
          await act(async () => {
            await run(index);
          });
          const wallMs = performance.now() - start;
          samples.push({ wallMs, profilerMs, commits, rows: counts.row, groups: counts.group, older: counts.older });
        }
        return samples;
      };

      const events: Record<string, (index: number) => Promise<void> | void> = {
        // The host replaces one thread object (idle ↔ working).
        "one thread changes (host)": (index) => {
          const working = index % 2 === 0;
          threadsStore.set(
            threadsStore.get().map((thread) =>
              thread.id === target.id
                ? {
                    ...thread,
                    status: working ? "active" : "idle",
                    runtimeStatus: working ? "active" : "idle",
                    updatedAt: thread.updatedAt + 1,
                  }
                : thread,
            ),
          );
        },
        "stamp signal (realtime)": (index) =>
          slot.emitRealtime(CHANNELS.stamps, { kind: "startedAt", threadIds: [target.id], value: 1_800_000_000_000 + index }),
        "note signal (realtime)": (index) =>
          slot.emitRealtime(CHANNELS.notes, {
            threadId: target.id,
            notes: index % 2 === 0 ? { done: { kind: "done", text: `Done ${index}`, at: 1_800_000_000_000 + index } } : null,
          }),
        "navigate (active thread)": (index) => activeStore.set(index % 2 === 0 ? other.id : target.id),
      };

      const scenarioResult: Record<string, unknown> = { mountedRows, threads: base.length };
      for (const [name, run] of Object.entries(events)) {
        const samples = await measure(run);
        scenarioResult[name] = {
          wallMsMedian: Number(median(samples.map((sample) => sample.wallMs)).toFixed(2)),
          profilerMsMedian: Number(median(samples.map((sample) => sample.profilerMs)).toFixed(2)),
          commitsMedian: median(samples.map((sample) => sample.commits)),
          rowRendersMedian: median(samples.map((sample) => sample.rows)),
          rowRendersPerMountedRow: Number((median(samples.map((sample) => sample.rows)) / mountedRows).toFixed(3)),
          groupRendersMedian: median(samples.map((sample) => sample.groups)),
          foldRowRendersMedian: median(samples.map((sample) => sample.older)),
        };
      }
      results[scenario] = scenarioResult;
      slot.unmount();
      cleanup();
    }
    console.log(JSON.stringify(results, null, 2));
    if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
  }, 600_000);
});

describe.skipIf(!SNAPSHOT)("list model cost over a real snapshot", () => {
  it("times buildForest and buildListView per update", async () => {
    const { buildForest } = await import("@/features/thread-list/model/families");
    const { buildListView } = await import("@/features/thread-list/model/view");
    const raw = JSON.parse(readFileSync(SNAPSHOT!, "utf8")) as CliThread[];
    const threads = raw.map(toSidebarThread);
    const out: Record<string, unknown> = {};
    for (const [scenario, prefs] of Object.entries(SCENARIOS)) {
      const preferences = { ...defaultPreferences(), ...prefs };
      const forestMs: number[] = [];
      const viewMs: number[] = [];
      for (let index = 0; index < 200; index += 1) {
        const a = performance.now();
        const forest = buildForest({
          threads,
          activeThreadId: null,
          finishedAt: {},
          seenAt: {},
          draftIds: new Set(),
          scheduled: {},
          now: Date.now(),
          notes: {},
          childAttention: preferences.childAttention,
        });
        const b = performance.now();
        buildListView({ forest, threads, projects, sections: [], prefs: preferences, activeThreadId: null, held: null, targets: new Map() });
        const c = performance.now();
        forestMs.push(b - a);
        viewMs.push(c - b);
      }
      out[scenario] = {
        buildForestMsMedian: Number(median(forestMs.slice(20)).toFixed(3)),
        buildListViewMsMedian: Number(median(viewMs.slice(20)).toFixed(3)),
      };
    }
    console.log(JSON.stringify(out, null, 2));
    if (OUT) writeFileSync(OUT.replace(/\.json$/, ".model.json"), JSON.stringify(out, null, 2));
  });
});
