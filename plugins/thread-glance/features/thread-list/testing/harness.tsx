// The shared setup of the list's tests: the plugin app loaded once against
// the fake host, and a `mount` that opens a window on a scenario.
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { flushListStores } from "../store/list-store";
import { createFakeHost, loadWithFakeHost, mountList, serverState, type FakeHost, type ServerState } from "./fake-host";
import type { FakeServerOptions } from "./fake-server";
import { PROJECTS } from "./fixtures";

type App = Awaited<ReturnType<typeof loadWithFakeHost>>;
let app: App;

/** Registers the loading and cleanup every list test needs. */
export function useListHarness(): void {
  beforeAll(async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    app = await loadWithFakeHost();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
}

export interface Scenario {
  threads: PluginSidebarThread[];
  projects?: PluginSidebarProject[];
  server?: FakeServerOptions | ServerState;
  activeThreadId?: string | null;
  isCompactViewport?: boolean;
  failReorderPinned?: boolean;
  onThreadsRead?(): void;
}

export interface Mounted {
  host: FakeHost;
  server: ServerState;
  view: ReturnType<typeof mountList>;
}

/** Opens a window on `scenario` and waits for the list to be drawn. */
export async function mount(scenario: Scenario): Promise<Mounted> {
  const server = isServer(scenario.server) ? scenario.server : serverState(scenario.server);
  const host = createFakeHost({
    threads: scenario.threads,
    projects: scenario.projects ?? PROJECTS,
    activeThreadId: scenario.activeThreadId,
    isCompactViewport: scenario.isCompactViewport,
    failReorderPinned: scenario.failReorderPinned,
    onThreadsRead: scenario.onThreadsRead,
  });
  const view = mountList(app, server);
  await settle();
  return { host, server, view };
}

function isServer(value: Scenario["server"]): value is ServerState {
  return value !== undefined && "handlers" in value;
}

/** Applies what bb and the server have sent, as a frame would, and lets promises run. */
export async function settle(): Promise<void> {
  await waitFor(() => {
    flushListStores();
    if (document.querySelector("[data-list-ready],[role=alert]") === null) throw new Error("still loading");
  });
  await Promise.resolve();
  flushListStores();
}

/** Lets what a test did (a signal, a host update) reach the screen. */
export async function flush(): Promise<void> {
  await Promise.resolve();
  flushListStores();
  await Promise.resolve();
}
