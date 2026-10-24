// @vitest-environment jsdom
// #342: a title that mentions a project, a section or a thread is drawn by bb's
// ThreadTitle wherever the list shows it, a rename edits the stored title, and
// text that is only read aloud, or shown where bb cannot draw it, uses the plain one.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settledRow } from "@/shared/lifecycle";
import { busyRefusal, childNeedsYouRefusal } from "@/shared/messages";
import { makeThread, working } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { forgetModelLookups } from "../sync/model-lookup";
import { closeHoverCards } from "./rows/hover-state";
import { createLifecycleCommands, lifecycleHostOf } from "../commands/lifecycle";
import { waitingChildTitle } from "../model/forest";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

useListHarness();

afterEach(() => {
  closeHoverCards();
  forgetModelLookups();
  toasts.error.mockClear();
});

const NOW = Date.now();
const MIN = 60_000;
const fresh = { createdAt: NOW - 5 * MIN, updatedAt: NOW - 5 * MIN, latestAttentionAt: NOW - 5 * MIN };
const old = { createdAt: NOW - 4 * 86_400_000, updatedAt: NOW - 3 * 86_400_000, latestAttentionAt: NOW - 3 * 86_400_000 };
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
const titleIn = (root: ParentNode, id: string) => root.querySelector(`[data-thread-title="${id}"]`)?.textContent;

const mentioned = (patch: Partial<Parameters<typeof makeThread>[0]> = {}) =>
  makeThread({ id: "a", title: "Fix @project:proj_a", displayTitle: "Fix Alpha", ...fresh, ...patch });

describe("a row", () => {
  it("draws the title through ThreadTitle on a Full card, and names its buttons by the plain title", async () => {
    await mount({ threads: [mentioned()] });
    expect(titleIn(card("a"), "a")).toBe("Fix Alpha");
    expect(card("a").textContent).not.toContain("@project");
    expect(screen.getByRole("link", { name: "Fix Alpha" })).toBeTruthy();
  });

  it("draws a child's title in the list under its parent through ThreadTitle", async () => {
    await mount({
      threads: [
        makeThread({ id: "p", title: "Parent", ...fresh }),
        makeThread({ id: "c", title: "Child @thread:p", displayTitle: "Child Parent", parentThreadId: "p", ...fresh }),
      ],
    });
    fireEvent.click(card("p").querySelector("[data-children-chip]")!);
    await flush();
    const child = document.querySelector<HTMLElement>('[data-child-id="c"]')!;
    expect(titleIn(child, "c")).toBe("Child Parent");
  });
});

describe("renaming a title with a mention", () => {
  const updates = (m: Awaited<ReturnType<typeof mount>>) => m.host.sdkCalls.filter((call) => call.method === "threads.update").map((call) => call.args);

  it("opens the editor on the stored title, and saves the stored title back as it was typed", async () => {
    const m = await mount({ threads: [mentioned()] });
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    const input = screen.getByRole("textbox", { name: "Rename Fix Alpha" }) as HTMLInputElement;
    expect(input.value).toBe("Fix @project:proj_a");
    fireEvent.change(input, { target: { value: "Fix @project:proj_a again" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await flush();
    expect(updates(m)).toEqual([{ threadId: "a", title: "Fix @project:proj_a again" }]);
  });

  it("saves nothing when the stored title is left as it is", async () => {
    const m = await mount({ threads: [mentioned()] });
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });
    await flush();
    expect(updates(m)).toEqual([]);
  });

  it("draws the chip again once the saved title comes back", async () => {
    const m = await mount({ threads: [mentioned()] });
    fireEvent.doubleClick(card("a").querySelector("a")!);
    await flush();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Fix @project:proj_b" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    act(() => m.host.updateThread("a", { title: "Fix @project:proj_b", displayTitle: "Fix Beta" }));
    await flush();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(titleIn(card("a"), "a")).toBe("Fix Beta");
  });
});

describe("the Hover card", () => {
  it("draws the title and each subthread's title through ThreadTitle", async () => {
    await mount({
      threads: [
        mentioned({ id: "a" }),
        makeThread({ id: "c", title: "Sub @project:proj_a", displayTitle: "Sub Alpha", parentThreadId: "a", ...fresh }),
      ],
      slot: { sdk: { threads: { defaultExecutionOptions: async () => ({ model: "m", reasoningLevel: "high" }) }, providers: { models: async () => ({ models: [] }) } } },
    });
    fireEvent.keyDown(document.body, { key: "Tab" });
    await act(async () => document.querySelector<HTMLElement>('a[data-sidebar-thread-id="a"]')!.focus());
    await flush();
    const hover = document.querySelector<HTMLElement>("[data-hover-card]")!;
    expect(titleIn(hover, "a")).toBe("Fix Alpha");
    fireEvent.click(within(hover).getByRole("button", { name: /Subthreads/ }));
    expect(titleIn(hover, "c")).toBe("Sub Alpha");
  });
});

describe("text that is only read aloud", () => {
  it("announces a keyboard move by the plain title", async () => {
    await mount({
      threads: [mentioned({ id: "a" }), makeThread({ id: "b", title: "B", ...fresh })],
      server: { order: ["a", "b"] },
    });
    const row = document.querySelector<HTMLElement>('[data-thread-id="a"]')!;
    await act(async () => {
      fireEvent.keyDown(row, { key: "ArrowDown", altKey: true });
    });
    await flush();
    expect(screen.getByRole("status").textContent).toContain("Fix Alpha moved to 2 of 2");
    expect(screen.getByRole("status").textContent).not.toContain("@project");
  });
});

describe("the Clean dialog", () => {
  const settled = { a: settledRow(NOW - 1_000, "manual") };

  it("draws a thread's title and its problems through ThreadTitle, and a thread bb no longer lists by the stored title", async () => {
    const m = await mount({
      threads: [mentioned({ id: "a", ...old })],
      server: {
        rows: settled,
        answers: {
          previewClean: {
            token: "tok",
            expiresAt: NOW + 120_000,
            threads: [
              { threadId: "a", title: "Fix @project:proj_a", terminals: 1, ports: [] },
              { threadId: "gone", title: "Archived since", terminals: 1, ports: [] },
            ],
          },
          runClean: {
            expired: false,
            closedTerminals: 0,
            portRequests: 0,
            stillListening: [],
            issues: [
              { threadId: "a", title: "Fix @project:proj_a", text: "a terminal could not be closed" },
              { threadId: "gone", title: "Archived since", text: "its workspace could not be found" },
            ],
          },
        },
      },
    });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Close terminals and ports of settled threads" })));
    await flush();
    await waitFor(() => expect(m.server.calls.some((call) => call.method === "previewClean")).toBe(true));
    await flush();
    const dialog = screen.getByRole("alertdialog");
    const listed = dialog.querySelector('[data-clean-thread="a"]')!;
    expect(titleIn(listed, "a")).toBe("Fix Alpha");
    expect(screen.getByRole("button", { name: "Open Fix Alpha" })).toBeTruthy();
    const gone = dialog.querySelector('[data-clean-thread="gone"]')!;
    expect(gone.textContent).toContain("Archived since");
    expect(gone.querySelector("[data-thread-title]")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Archived since" })).toBeTruthy();
    await act(async () => void fireEvent.click(within(dialog).getByRole("button", { name: "Clean resources" })));
    await flush();
    const issues = [...dialog.querySelectorAll("[data-clean-result] p")].map((line) => line.textContent);
    expect(issues).toContain("Fix Alpha: a terminal could not be closed");
    expect(issues).toContain("Archived since: its workspace could not be found");
    expect(titleIn(dialog.querySelector("[data-clean-result]")!, "a")).toBe("Fix Alpha");
  });
});

describe("a refusal toast", () => {
  // bb draws ThreadTitle only inside its sidebar, and bb's toaster sits outside it, so a toast names the thread in plain text.
  it("names a busy thread by its resolved name, as plain text", async () => {
    const m = await mount({ threads: [mentioned({ id: "a", ...working })] });
    const call = vi.fn();
    const lifecycle = createLifecycleCommands(lifecycleHostOf({ call } as never, (id) => m.host.state().threads.find((thread) => thread.id === id) ?? null));
    await lifecycle.park("a");
    expect(toasts.error.mock.calls.map((entry) => entry[0])).toEqual([busyRefusal("park", "Fix Alpha")]);
    expect(call).not.toHaveBeenCalled();
  });

  it("names a waiting child by its resolved name, as plain text", async () => {
    const threads = [
      makeThread({ id: "p", title: "Parent", ...old }),
      makeThread({ id: "c", title: "Kid @project:proj_a", displayTitle: "Kid Alpha", parentThreadId: "p", hasPendingInteraction: true, ...old }),
    ];
    const m = await mount({ threads });
    const lookup = (id: string) => m.host.state().threads.find((thread) => thread.id === id) ?? null;
    const lifecycle = createLifecycleCommands(lifecycleHostOf({ call: vi.fn() } as never, lookup, (id) => waitingChildTitle(m.host.state().threads, id)));
    await lifecycle.settle("p");
    expect(toasts.error.mock.calls.map((entry) => entry[0])).toEqual([childNeedsYouRefusal("settle", "Kid Alpha")]);
  });
});
