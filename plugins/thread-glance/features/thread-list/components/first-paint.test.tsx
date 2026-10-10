// @vitest-environment jsdom
// The first drawn list: settling reads only what the list is drawn from, so
// a thread's place in or out of the settled fold is right on first paint and
// stays put as the default-branch, pull request and stamp lookups answer.
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { createFakeServer, makeThread, PROJECTS } from "../testing/fixtures";

// The SDK's fake pull request hook answers at once; this one reports a
// lookup in flight until `answerPullRequests` runs.
const pullRequestLookup = (() => {
  let answered = false;
  const listeners = new Set<() => void>();
  return {
    answered: () => answered,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value: boolean) {
      answered = value;
      for (const listener of listeners) listener();
    },
  };
})();
const lookedUp: string[] = [];
// What the pull request's row does not read, as bb 0.46 reports it.
const PULL_REQUEST_FACTS = {
  experimental_autoMerge: false,
  experimental_inMergeQueue: false,
  experimental_checks: { state: "no_checks" },
  experimental_review: { state: "none" },
  experimental_mergeability: { state: "unknown" },
} as const;

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    experimental_useSidebarThreadPullRequest(threadId: string) {
      lookedUp.push(threadId);
      const answer = actual.experimental_useSidebarThreadPullRequest(threadId);
      const answered = useSyncExternalStore(pullRequestLookup.subscribe, pullRequestLookup.answered);
      return answered ? answer : { isLoading: true, pullRequest: null };
    },
  };
});

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  app = await loadPluginApp(() => import("../../../app"));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  pullRequestLookup.set(false);
  lookedUp.length = 0;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function render() {
  const now = Date.now();
  const old = now - 30 * DAY;
  const recent = now - HOUR;
  // A finish bb carries in latestAttentionAt, read, and stamped by the server.
  const finished = { latestAttentionAt: recent, lastReadAt: recent };
  const threads = [
    makeThread({ id: "s", title: "Settled", environment: { branchName: "feature-s" }, createdAt: old, latestAttentionAt: old, lastReadAt: old }),
    makeThread({ id: "r", title: "Recent", environment: { branchName: "feature-r" }, createdAt: old, ...finished }),
    makeThread({ id: "p", title: "Parent", createdAt: old, latestAttentionAt: old, lastReadAt: old }),
    makeThread({ id: "c", title: "Child", parentThreadId: "p", createdAt: old, ...finished }),
  ];
  // One `sync` brings the preferences and the stamps together, so the
  // server holds these stamps back and sends them later, as a signal.
  const server = createFakeServer({ preferences: { organizationMode: "project", settleAfter: "1d" } });
  const project = deferred<unknown>();
  server.attach(renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate() {}, searchQuery: "" },
    {
      rpc: server.handlers as never,
      sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
      providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
      // Pull request states, which do not settle a thread.
      sidebarPullRequests: {
        s: { number: 1, title: "Open", url: "https://example.test/1", state: "open", attention: "none", ...PULL_REQUEST_FACTS },
        r: { number: 2, title: "Merged", url: "https://example.test/2", state: "merged", attention: "merged", ...PULL_REQUEST_FACTS },
      },
      sdk: {
        threads: { defaultExecutionOptions: async () => null } as never,
        projects: {
          get: () => project.promise,
          branches: async () => ({ defaultBranch: "main" }),
        } as never,
        providers: { models: async () => ({ models: [] }) } as never,
      },
    },
  ));
  return {
    async answerAll() {
      await server.stamp("startedAt", ["r", "c"], recent - HOUR);
      await server.stamp("finishedAt", ["r", "c"], recent);
      project.resolve({ sources: [{ hostId: "host_1", isDefault: true }] });
      pullRequestLookup.set(true);
      // The badge on Recent shows once its default branch and pull request answered.
      await screen.findByRole("generic", { name: /Pull request #2/ });
    },
  };
}

/** Which threads are drawn outside the fold, and what the fold says. */
function placement() {
  const drawn = ["Settled", "Recent", "Parent"].filter((title) => screen.queryByRole("link", { name: new RegExp(`Open ${title}\\b`) }) !== null);
  const fold = screen.queryByRole("button", { name: /settled thread tree/ })?.textContent ?? null;
  return { drawn, fold };
}

describe("the settled fold on first paint", () => {
  it("draws the list while every other lookup is pending, and keeps each thread's place once they answer", async () => {
    const list = render();
    await screen.findByRole("link", { name: /Open Recent/ });
    const first = placement();
    // Settled, off its project's default branch, is in the fold; Recent,
    // and Parent's tree through its child's finish, are outside it.
    expect(first).toEqual({ drawn: ["Recent", "Parent"], fold: "Settled (1)" });
    expect(screen.queryByRole("generic", { name: /Pull request/ })).toBeNull();

    await list.answerAll();
    expect(placement()).toEqual(first);
    // The row badge is the only one to look up a pull request.
    expect(new Set(lookedUp)).toEqual(new Set(["r"]));
  });
});
