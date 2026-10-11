// @vitest-environment jsdom
// The dialogs the thread menu opens: "Snooze until" (AC5, picker half),
// Parent… (AC21) and the Project ▸ dialogs (AC22).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThread, PROJECTS } from "@/testing/fixtures";
import { requestSnoozePicker } from "@/features/thread-list";
import { NEEDS_APP_OVERLAY } from "@/lib/dialog-requests";
import { requestParentDialog, requestProjectDialog } from "../requests";
import { PARENT_BELOW_REFUSAL } from "../model/parents";
import { PARENT_REMOVED, PARENT_UPDATED, UNPIN_UNCONFIRMED } from "./ParentDialog";
import { REMOVE_WARNING, RemoveProjectConfirmation } from "./RemoveProject";
import { ThreadActionDialogs } from "./ThreadActionDialogs";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Radix reads these from the DOM in jsdom.
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
beforeEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const VERSIONED = { epoch: "e", version: 2, value: { colours: {}, icons: {} } };

function mountDialogs(options: { threads?: ReturnType<typeof makeThread>[]; sdk?: Record<string, unknown>; rpc?: Record<string, unknown> } = {}) {
  const calls: { method: string; args: unknown }[] = [];
  const record = (method: string, result: unknown = {}) =>
    vi.fn(async (args: unknown) => {
      calls.push({ method, args });
      return result;
    });
  const sdk = {
    threads: { update: record("threads.update"), unpin: record("threads.unpin"), get: record("threads.get") },
    projects: { update: record("projects.update"), delete: record("projects.delete", { ok: true }), sources: { add: record("sources.add") } },
    hosts: { list: vi.fn(async () => [{ id: "h1", name: "Laptop" }, { id: "h2", name: "Server" }]) },
    ...options.sdk,
  };
  const rpc = {
    snooze: vi.fn(async (args: unknown) => {
      calls.push({ method: "snooze", args });
      return { changes: [], reclaim: { stopped: false, closed: 0, left: 0 }, note: null };
    }),
    forgetProject: vi.fn(async (args: unknown) => {
      calls.push({ method: "forgetProject", args });
      return VERSIONED;
    }),
    ...options.rpc,
  };
  const view = renderSlot({ component: ThreadActionDialogs }, {}, {
    sidebarThreads: { status: "ready", threads: options.threads ?? [makeThread({ id: "t1", title: "Subject" })], projects: PROJECTS },
    sdk: sdk as never,
    rpc: rpc as never,
  });
  return { view, sdk, rpc, calls };
}

describe("without bb's app overlay, where no dialogs are mounted", () => {
  it("says each dialog's action needs it, instead of doing nothing", () => {
    requestSnoozePicker("t1");
    requestParentDialog("t1");
    requestProjectDialog("rename", "proj_a");
    expect(toasts.error.mock.calls).toEqual(Array(3).fill([NEEDS_APP_OVERLAY]));
  });
});

describe("Snooze until (AC5)", () => {
  // Saturday, Oct 3 2026, 14:30 local.
  const NOW = new Date(2026, 9, 3, 14, 30).getTime();
  const open = () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
    const mounted = mountDialogs();
    act(() => requestSnoozePicker("t1"));
    return mounted;
  };
  const snoozeButton = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Snooze" });
  const setTime = (value: string) => act(() => void fireEvent.change(screen.getByLabelText("Time"), { target: { value } }));

  it("starts on tomorrow 09:00 with a preview, and snoozes until then", async () => {
    const { calls } = open();
    expect(screen.getByRole("dialog", { name: "Snooze until" })).toBeTruthy();
    expect(screen.getByText("Wakes Sun, Oct 4, 9:00 AM")).toBeTruthy();
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("09:00");

    await act(async () => void fireEvent.click(snoozeButton()));
    expect(calls).toContainEqual({ method: "snooze", args: { threadId: "t1", until: new Date(2026, 9, 4, 9, 0).getTime() } });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts the week on Monday and disables the days before today", () => {
    open();
    const headers = [...document.querySelectorAll("th")].map((cell) => cell.textContent);
    expect(headers[0]).toMatch(/^Mo/);
    expect((screen.getByRole("button", { name: /Friday, October 2nd, 2026/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Sunday, October 4th, 2026/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Snooze with 'Pick a time in the future.' for a time that has passed today", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Saturday, October 3rd, 2026/ }));
    setTime("09:00");
    expect(screen.getByRole("alert").textContent).toBe("Pick a time in the future.");
    expect((snoozeButton() as HTMLButtonElement).disabled).toBe(true);
    setTime("15:00");
    expect(screen.queryByRole("alert")).toBeNull();
    expect((snoozeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Snooze with 'Enter a time.' when the time is cleared", () => {
    open();
    setTime("");
    expect(screen.getByRole("alert").textContent).toBe("Enter a time.");
    expect((snoozeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads the clock again every 15 s, so a time that comes to pass while the dialog is open is refused", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Saturday, October 3rd, 2026/ }));
    setTime("14:35");
    expect(screen.queryByRole("alert")).toBeNull();
    // 14:35 is five minutes ahead, so the clock is moved past it, and nothing is refused until the next 15 s tick reads it.
    vi.setSystemTime(NOW + 6 * 60_000);
    act(() => void vi.advanceTimersByTime(14_999));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByRole("alert").textContent).toBe("Pick a time in the future.");
  });
});

describe("Parent… (AC21)", () => {
  const subject = makeThread({ id: "t1", title: "Subject", isPinned: true, pinnedAt: 5 });
  const threads = [
    subject,
    makeThread({ id: "p1", title: "Alpha parent", updatedAt: 5 }),
    makeThread({ id: "p2", title: "Other project parent", projectId: "proj_b", updatedAt: 9 }),
    makeThread({ id: "c1", title: "Its child", parentThreadId: "t1" }),
  ];
  const options = () => screen.getAllByRole("option").map((option) => option.textContent);

  it("lists None first, without the thread and its descendants, and the other project's threads as 'Project · Title'", () => {
    mountDialogs({ threads });
    act(() => requestParentDialog("t1"));
    expect(options()).toEqual(["None", "Alpha parent", "Beta · Other project parent"]);
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("filters by the search, keeping None", () => {
    mountDialogs({ threads });
    act(() => requestParentDialog("t1"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "beta" } });
    expect(options()).toEqual(["None", "Beta · Other project parent"]);
  });

  it("makes the chosen thread the parent and unpins a pinned thread, with a note saying so", async () => {
    const { calls } = mountDialogs({ threads });
    act(() => requestParentDialog("t1"));
    expect(screen.getByText(/unpins this thread/)).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole("option", { name: "Alpha parent" })));
    expect(calls.map((call) => call.method)).toEqual(["threads.update", "threads.unpin"]);
    expect(calls[0]!.args).toEqual({ threadId: "t1", parentThreadId: "p1" });
    expect(toasts.success).toHaveBeenCalledWith(PARENT_UPDATED);
  });

  it("keeps the pin when None is chosen", async () => {
    const child = makeThread({ id: "t1", title: "Subject", isPinned: true, pinnedAt: 5, parentThreadId: "p1" });
    const { calls } = mountDialogs({ threads: [child, threads[1]!] });
    act(() => requestParentDialog("t1"));
    expect(screen.getByRole("option", { name: "Alpha parent" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => void fireEvent.click(screen.getByRole("option", { name: "None" })));
    expect(calls).toEqual([{ method: "threads.update", args: { threadId: "t1", parentThreadId: null } }]);
    expect(toasts.success).toHaveBeenCalledWith(PARENT_REMOVED);
  });

  it("says unpinning could not be confirmed when the unpin fails after the parent changed", async () => {
    const update = vi.fn(async () => ({}));
    mountDialogs({
      threads,
      sdk: { threads: { update, unpin: vi.fn(async () => Promise.reject(new Error("no"))), get: vi.fn() } },
    });
    act(() => requestParentDialog("t1"));
    await act(async () => void fireEvent.click(screen.getByRole("option", { name: "Alpha parent" })));
    expect(update).toHaveBeenCalledWith({ threadId: "t1", parentThreadId: "p1" });
    expect(toasts.error).toHaveBeenCalledWith(UNPIN_UNCONFIRMED);
  });

  it("chooses with the keyboard: arrows move, Enter picks", async () => {
    const { calls } = mountDialogs({ threads: [makeThread({ id: "t1", title: "Subject" }), threads[1]!] });
    act(() => requestParentDialog("t1"));
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
    expect(calls[0]!.args).toEqual({ threadId: "t1", parentThreadId: "p1" });
  });

  it("refuses a parent that sits below the thread through an archived thread, and changes nothing", async () => {
    // Subject <- Archived <- Deep: Deep is listed, its parent is not.
    const deep = makeThread({ id: "deep", title: "Deep", parentThreadId: "archived" });
    const { calls } = mountDialogs({
      threads: [makeThread({ id: "t1", title: "Subject" }), deep],
      sdk: {
        threads: {
          get: vi.fn(async () => ({
            id: "archived", title: "Archived", titleFallback: null, projectId: "proj_a", parentThreadId: "t1",
            archivedAt: 3, createdAt: 1, updatedAt: 2, latestAttentionAt: 2,
          })),
          update: vi.fn(),
          unpin: vi.fn(),
        },
      },
    });
    act(() => requestParentDialog("t1"));
    await act(async () => void fireEvent.click(screen.getByRole("option", { name: "Deep" })));
    expect(toasts.error).toHaveBeenCalledWith(PARENT_BELOW_REFUSAL);
    expect(calls.map((call) => call.method)).not.toContain("threads.update");
  });

  it("shows an archived current parent, read from bb, as checked", async () => {
    const child = makeThread({ id: "t1", title: "Subject", parentThreadId: "gone" });
    mountDialogs({
      threads: [child],
      sdk: {
        threads: {
          get: vi.fn(async () => ({
            id: "gone", title: "Archived parent", titleFallback: null, projectId: "proj_a", parentThreadId: null,
            archivedAt: 3, createdAt: 1, updatedAt: 2, latestAttentionAt: 2,
          })),
          update: vi.fn(),
          unpin: vi.fn(),
        },
      },
    });
    act(() => requestParentDialog("t1"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Archived parent" }).getAttribute("aria-selected")).toBe("true"));
  });
});

describe("Project ▸ dialogs (AC22)", () => {
  it("renames the project", async () => {
    const { calls } = mountDialogs();
    act(() => requestProjectDialog("rename", "proj_a"));
    const field = screen.getByLabelText("Project name") as HTMLInputElement;
    expect(field.value).toBe("Alpha");
    fireEvent.change(field, { target: { value: "  Alpha two  " } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Rename" })));
    expect(calls).toContainEqual({ method: "projects.update", args: { projectId: "proj_a", name: "Alpha two" } });
  });

  it("refuses a name over 500 characters", () => {
    mountDialogs();
    act(() => requestProjectDialog("rename", "proj_a"));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "a".repeat(501) } });
    expect(screen.getByRole("alert").textContent).toBe("Use at most 500 characters.");
    expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds a local path on the chosen machine", async () => {
    const { calls } = mountDialogs();
    act(() => requestProjectDialog("add-path", "proj_a"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Server" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Machine"), { target: { value: "h2" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: " /srv/app " } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add path" })));
    expect(calls).toContainEqual({ method: "sources.add", args: { projectId: "proj_a", type: "local_path", hostId: "h2", path: "/srv/app" } });
  });

  it("adds a local path on the first machine bb lists when none is picked", async () => {
    const { calls } = mountDialogs();
    act(() => requestProjectDialog("add-path", "proj_a"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Laptop" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "/srv/app" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Add path" })));
    expect(calls).toContainEqual({ method: "sources.add", args: { projectId: "proj_a", type: "local_path", hostId: "h1", path: "/srv/app" } });
  });

  it("says 'Could not load machines' and cannot add when the machines fail to load", async () => {
    mountDialogs({ sdk: { hosts: { list: vi.fn(async () => Promise.reject(new Error("offline"))) } } });
    act(() => requestProjectDialog("add-path", "proj_a"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not load machines"));
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "/srv/app" } });
    expect((screen.getByRole("button", { name: "Add path" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a folder over 4,096 characters", async () => {
    mountDialogs();
    act(() => requestProjectDialog("add-path", "proj_a"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Laptop" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "/".padEnd(4_097, "a") } });
    expect(screen.getByRole("alert").textContent).toBe("Use at most 4,096 characters.");
  });

  it("removes the project only once its exact name is typed, and has the server forget its colour and icon", async () => {
    const { calls } = mountDialogs();
    act(() => requestProjectDialog("remove", "proj_a"));
    const remove = () => screen.getByRole("button", { name: "Remove project" }) as HTMLButtonElement;
    expect(screen.getByText(REMOVE_WARNING)).toBeTruthy();
    expect(remove().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "alpha" } });
    expect(remove().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Alpha" } });
    expect(remove().disabled).toBe(false);
    await act(async () => void fireEvent.click(remove()));
    expect(calls.map((call) => call.method)).toEqual(["projects.delete", "forgetProject"]);
    expect(calls[1]!.args).toEqual({ projectId: "proj_a" });
  });

  it("does not forget the colour and icon when bb refuses to remove the project", async () => {
    const { calls } = mountDialogs({ sdk: { projects: { delete: vi.fn(async () => Promise.reject(new Error("Nope"))) } } });
    act(() => requestProjectDialog("remove", "proj_a"));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Alpha" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Remove project" })));
    expect(calls.map((call) => call.method)).not.toContain("forgetProject");
    expect(toasts.error).toHaveBeenCalledWith("Nope");
  });
});

describe("RemoveProjectConfirmation, as the settings page uses it", () => {
  it("confirms only for the exact name, with the warning", async () => {
    const onConfirm = vi.fn();
    render(<RemoveProjectConfirmation projectName="My Project" onConfirm={onConfirm} />);
    expect(screen.getByText(REMOVE_WARNING)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Remove project" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My Projec" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My Project" } });
    await act(async () => void fireEvent.click(button));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
