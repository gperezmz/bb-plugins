// @vitest-environment jsdom
// What the app takes from each realtime channel: a valid payload lands, one of
// the wrong type is dropped, and a note longer than NOTE_MAX_LENGTH is dropped.
// Stamps and notes both come as thread records on the `records` channel.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { CHANNELS, NOTE_MAX_LENGTH } from "@/shared/signals";
import { defaultPreferences, PREFERENCES_MIRROR_STORAGE_KEY } from "@/shared/preferences";
import { createFakeServer, makeThread, type FakeServer, PROJECTS, T0, working } from "../testing/fixtures";

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
});

const threads = [
  makeThread({ id: "w", title: "Worker", ...working }),
  makeThread({ id: "f", title: "Broken", status: "error" }),
  makeThread({ id: "s", title: "Later", queuedWork: "waiting" }),
];

let server: FakeServer;

async function renderList() {
  server = createFakeServer({ preferences: { settleAfter: "never" } });
  const slot = renderSlot(
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
  );
  await screen.findByRole("link", { name: /Later/ });
  // Let the initial loads land before signalling.
  await settle();
  return slot;
}

/** Lets a dropped signal have its chance to render. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function mirrored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PREFERENCES_MIRROR_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
}

describe("realtime payloads", () => {
  /** A `records` signal from the server, at the next revision. */
  let revision = 0;
  const records = (records: unknown) => ({ epoch: server.epoch, revision: (revision += 1), records });

  it("notes: takes a valid note, drops one of the wrong type and one past the length cap", async () => {
    const slot = await renderList();
    await slot.emitRealtime(CHANNELS.records, records({ f: { stamps: null, notes: "Out of credits" } }));
    await slot.emitRealtime(
      CHANNELS.records,
      records({ f: { stamps: null, notes: { failed: { kind: "failed", text: "x".repeat(NOTE_MAX_LENGTH + 1), at: T0 } } } }),
    );
    await settle();
    expect(screen.queryByText("x".repeat(NOTE_MAX_LENGTH + 1))).toBeNull();
    await slot.emitRealtime(
      CHANNELS.records,
      records({ f: { stamps: null, notes: { failed: { kind: "failed", text: "y".repeat(NOTE_MAX_LENGTH), at: T0 } } } }),
    );
    expect(await screen.findByText("y".repeat(NOTE_MAX_LENGTH))).toBeTruthy();
  });

  it("preferences: takes a valid value, drops one of the wrong type", async () => {
    const slot = await renderList();
    await slot.emitRealtime(CHANNELS.preferences, { key: "organizationMode", value: 5 });
    await slot.emitRealtime(CHANNELS.preferences, { key: "organizationMode", value: "sideways" });
    await settle();
    expect(mirrored().organizationMode).toBe("project");
    await slot.emitRealtime(CHANNELS.preferences, { key: "organizationMode", value: "machine" });
    await waitFor(() => expect(mirrored().organizationMode).toBe("machine"));
  });

  it("stamps: takes a valid stamp, drops one of the wrong type", async () => {
    const slot = await renderList();
    const startedAt = Date.now() - 5.5 * 60_000;
    await slot.emitRealtime(CHANNELS.records, records({ w: { stamps: { startedAt: String(startedAt) }, notes: null } }));
    await slot.emitRealtime(CHANNELS.records, records({ w: { stamps: startedAt, notes: null } }));
    await settle();
    expect(screen.queryByLabelText("Working for 5m")).toBeNull();
    await slot.emitRealtime(CHANNELS.records, records({ w: { stamps: { startedAt }, notes: null } }));
    expect(await screen.findByLabelText("Working for 5m")).toBeTruthy();
  });

  it("scheduled: takes a valid map, drops a payload of the wrong type", async () => {
    const slot = await renderList();
    await slot.emitRealtime(CHANNELS.scheduled, "s");
    await settle();
    expect(screen.queryByLabelText(/Scheduled message/)).toBeNull();
    expect(screen.getAllByLabelText(/Message waiting to send/).length).toBeGreaterThan(0);
    await slot.emitRealtime(CHANNELS.scheduled, { status: "ready", scheduled: { s: Date.now() + 3_600_000 } });
    expect((await screen.findAllByLabelText(/Scheduled message/)).length).toBeGreaterThan(0);
  });
});
