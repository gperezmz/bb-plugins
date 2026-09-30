// @vitest-environment jsdom
// The render path: an event about one thread renders
// that thread's row and no other. Rows are counted by the thread id on their
// anchor, the harness's way (perf/harness/render-counter.ts), which must load
// before react-dom.
import "../../../perf/harness/render-counter";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { defaultPreferences } from "@/shared/preferences";
import { CHANNELS } from "@/shared/contract";
import { startCounting, stopCounting } from "../../../perf/harness/render-counter";
import { createFakeServer, makeThread, type FakeServer, PROJECTS, T0, working } from "../testing/fixtures";

/** Row renders by thread id since the list settled. */
function renders(): Record<string, number> {
  const count = stopCounting();
  startCounting();
  return Object.fromEntries(count.rowIds);
}

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
  stopCounting();
  cleanup();
  localStorage.clear();
});

const threads = [
  makeThread({ id: "w", title: "Worker", ...working }),
  makeThread({ id: "f", title: "Broken", status: "error" }),
  makeThread({ id: "p", title: "Parent" }),
  makeThread({ id: "c", title: "Child", parentThreadId: "p" }),
  ...Array.from({ length: 20 }, (_, index) => makeThread({ id: `r${index}`, title: `Row ${index}`, createdAt: T0 - index })),
];

let server: FakeServer;

function render() {
  server = createFakeServer({ preferences: { expandedChildren: ["p"], settleAfter: "never" } });
  return server.attach(renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate() {}, searchQuery: "" },
    {
      rpc: server.handlers as never,
      sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
      providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
      sdk: {
        threads: { defaultExecutionOptions: async () => null } as never,
        projects: {
          get: async () => ({ sources: [{ hostId: "host_1", isDefault: true }] }),
          branches: async () => ({ defaultBranch: "main" }),
        } as never,
        providers: { models: async () => ({ models: [] }) } as never,
      },
    },
  ));
}

async function settled() {
  await screen.findByRole("link", { name: /Row 19/ });
  // Let the initial loads land before counting.
  await new Promise((resolve) => setTimeout(resolve, 20));
  startCounting();
}

describe("render path", () => {
  it("renders only the stamped row on a stamp", async () => {
    render();
    await settled();
    await server.stamp("startedAt", ["w"], Date.now() - 5.5 * 60_000);
    await waitFor(() => expect(screen.getByLabelText("Working for 5m")).toBeTruthy());
    expect(renders()).toEqual({ w: 1 });
  });

  it("renders only the row whose note changed", async () => {
    render();
    await settled();
    await server.note("f", { failed: { kind: "failed", text: "Out of credits", at: T0 } });
    await waitFor(() => expect(screen.getByText("Out of credits")).toBeTruthy());
    expect(renders()).toEqual({ f: 1 });
  });

  it("renders no row on a signal that changes nothing drawn", async () => {
    render();
    await settled();
    await server.stamp("seenAt", ["r5"], T0 - 1);
    expect(renders()).toEqual({});
  });
});

// Rows and controllers skip renders, so what they read when called, and what
// an open card shows, must still be the latest state.
describe("render path freshness", () => {
  it("keeps the details dialog current as notes and stamps arrive", async () => {
    render();
    await settled();
    const row = (await screen.findByRole("link", { name: /Open Row 1\b/ })).parentElement!;
    const trigger = within(row).getByRole("button", { name: "Thread actions" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Shipped the fix")).toBeNull();
    await server.note("r1", { done: { kind: "done", text: "Shipped the fix", at: T0 } });
    expect(await within(dialog).findByText("Shipped the fix")).toBeTruthy();
    const finished = () => within(dialog).getByText("Finished").nextElementSibling!.textContent;
    const before = finished();
    await server.stamp("finishedAt", ["r1"], T0 + 3 * 86_400_000);
    await waitFor(() => expect(finished()).not.toBe(before));
  });

  it("toggles a chip from the latest preferences, not the first ones", async () => {
    render();
    await settled();
    expect(await screen.findByRole("link", { name: /Open Child/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /child thread of Parent/ }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /Open Child/ })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /child thread of Parent/ }));
    expect(await screen.findByRole("link", { name: /Open Child/ })).toBeTruthy();
  });
});
