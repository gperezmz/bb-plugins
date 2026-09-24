// @vitest-environment jsdom
// The render path: an event about one thread renders
// that thread's row and no other.
import { memo } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { defaultPreferences } from "@/shared/preferences";
import { CHANNELS } from "@/shared/contract";
import { makeThread, PROJECTS, T0, working } from "../testing/fixtures";

const renders = new Map<string, number>();

vi.mock("./ThreadRowView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ThreadRowView")>();
  const inner = (actual.ThreadRowView as unknown as { type: (props: never) => React.ReactNode }).type;
  const Counting = (props: never) => {
    const id = (props as { row: { info: { thread: { id: string } } } }).row.info.thread.id;
    renders.set(id, (renders.get(id) ?? 0) + 1);
    return inner(props);
  };
  return { ...actual, ThreadRowView: memo(Counting) };
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
  renders.clear();
});

const threads = [
  makeThread({ id: "w", title: "Worker", ...working }),
  makeThread({ id: "f", title: "Broken", status: "error" }),
  makeThread({ id: "p", title: "Parent" }),
  makeThread({ id: "c", title: "Child", parentThreadId: "p" }),
  ...Array.from({ length: 20 }, (_, index) => makeThread({ id: `r${index}`, title: `Row ${index}`, createdAt: T0 - index })),
];

function render() {
  return renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate() {}, searchQuery: "" },
    {
      rpc: {
        listPreferences: () => ({ preferences: { ...defaultPreferences(), nesting: "tree", foldOlder: false } }),
        setPreference: ({ key, value }: { key: string; value: unknown }) => ({ key, value }),
        resetPreference: ({ key }: { key: string }) => ({ key, value: null }),
        importPreferences: () => ({ status: "already-imported" as const, source: null, keys: [] }),
        listStamps: () => ({ stamps: { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {} } }),
        markSeen: () => ({ at: Date.now() }),
        clearSeen: () => ({ ok: true as const }),
        listScheduled: () => ({ status: "ready" as const, scheduled: {} }),
        listNotes: () => ({ notes: {} }),
      } as never,
      sidebarThreads: { status: "ready", threads, projects: PROJECTS, sections: [] },
      providers: { status: "ready", providers: [{ id: "claude-code", displayName: "Claude Code", logoUrl: null }] as never },
      sdk: {
        threads: { defaultExecutionOptions: async () => null } as never,
        projects: { branches: async () => ({ defaultBranch: "main" }) } as never,
        providers: { models: async () => ({ models: [] }) } as never,
      },
    },
  );
}

async function settled() {
  await screen.findByRole("link", { name: /Row 19/ });
  // Let the initial loads land before counting.
  await new Promise((resolve) => setTimeout(resolve, 20));
  renders.clear();
}

describe("render path", () => {
  it("renders only the stamped row on a stamp", async () => {
    const slot = render();
    await settled();
    await slot.emitRealtime(CHANNELS.stamps, { kind: "startedAt", threadIds: ["w"], value: Date.now() - 5.5 * 60_000 });
    await waitFor(() => expect(screen.getByLabelText("Working for 5m")).toBeTruthy());
    expect(Object.fromEntries(renders)).toEqual({ w: 1 });
  });

  it("renders only the row whose note changed", async () => {
    const slot = render();
    await settled();
    await slot.emitRealtime(CHANNELS.notes, {
      threadId: "f",
      notes: { failed: { kind: "failed", text: "Out of credits", at: T0 } },
    });
    await waitFor(() => expect(screen.getByText("Out of credits")).toBeTruthy());
    expect(Object.fromEntries(renders)).toEqual({ f: 1 });
  });

  it("renders no row on a signal that changes nothing drawn", async () => {
    const slot = render();
    await settled();
    await slot.emitRealtime(CHANNELS.stamps, { kind: "seenAt", threadIds: ["r5"], value: T0 - 1 });
    expect(renders.size).toBe(0);
  });
});

// Rows and controllers skip renders, so what they read when called, and what
// an open card shows, must still be the latest state.
describe("render path freshness", () => {
  it("keeps the details dialog current as notes and stamps arrive", async () => {
    const slot = render();
    await settled();
    const row = (await screen.findByRole("link", { name: /Open Row 1\b/ })).parentElement!;
    const trigger = within(row).getByRole("button", { name: "Thread actions" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Shipped the fix")).toBeNull();
    await slot.emitRealtime(CHANNELS.notes, {
      threadId: "r1",
      notes: { done: { kind: "done", text: "Shipped the fix", at: T0 } },
    });
    expect(await within(dialog).findByText("Shipped the fix")).toBeTruthy();
    const finished = () => within(dialog).getByText("Finished").nextElementSibling!.textContent;
    const before = finished();
    await slot.emitRealtime(CHANNELS.stamps, { kind: "finishedAt", threadIds: ["r1"], value: T0 + 3 * 86_400_000 });
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
