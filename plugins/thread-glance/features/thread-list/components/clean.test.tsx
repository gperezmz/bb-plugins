// @vitest-environment jsdom
// AC8: the Clean button on the Settled header and the dialog behind it.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settledRow } from "@/shared/lifecycle";
import { CLEAN_EXPIRED_TEXT, CLEAN_NOTHING_TEXT } from "@/shared/ports";
import { makeThread } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

useListHarness();

const NOW = Date.now();
const old = { createdAt: NOW - 4 * 86_400_000, updatedAt: NOW - 3 * 86_400_000, latestAttentionAt: NOW - 3 * 86_400_000 };
const threads = [makeThread({ id: "a", title: "Dev server", ...old }), makeThread({ id: "b", title: "Beta thread", projectId: "proj_b", ...old })];
const rows = { a: settledRow(NOW - 1_000, "manual"), b: settledRow(NOW - 2_000, "manual") };

const preview = (found = true) => ({
  token: "tok-1",
  expiresAt: NOW + 120_000,
  threads: found
    ? [
        { threadId: "a", title: "Dev server", terminals: 2, ports: [{ port: 5173, process: "node" }, { port: 3000, process: null }] },
        { threadId: "b", title: "Beta thread", terminals: 1, ports: [] },
      ]
    : [],
});
const result = (patch: object = {}) => ({ expired: false, closedTerminals: 3, portRequests: 1, stillListening: [], issues: [], ...patch });

beforeEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
});

const cleanButton = () => screen.getByRole("button", { name: "Close terminals and ports of settled threads" });
const dialog = () => screen.getByRole("alertdialog");
const calls = (m: Awaited<ReturnType<typeof mount>>, method: string) => m.server.calls.filter((call) => call.method === method);
async function openDialog(m: Awaited<ReturnType<typeof mount>>) {
  await act(async () => void fireEvent.click(cleanButton()));
  await flush();
  await waitFor(() => expect(calls(m, "previewClean")).not.toHaveLength(0));
  await flush();
}
const press = async (name: string | RegExp) => {
  await act(async () => void fireEvent.click(within(dialog()).getByRole("button", { name })));
  await flush();
};

describe("AC8: the Clean button", () => {
  it("is a broom on the Settled header while the shelf is collapsed, with its label and tooltip", async () => {
    await mount({ threads, server: { rows } });
    expect(screen.getByRole("button", { name: "Settled (2)" }).getAttribute("aria-expanded")).toBe("false");
    const button = cleanButton();
    expect(button.textContent).toBe("");
    expect(button.querySelector("[data-icon=thread-glance-clean]")).not.toBeNull();
    await act(async () => void fireEvent.focus(button));
    expect((await screen.findAllByText("Close terminals and ports of settled threads (threads stay in Settled)")).length).toBeGreaterThan(0);
  });

  it("is on no other shelf's header", async () => {
    await mount({ threads, server: { rows: { b: rows.b } } });
    expect(screen.getAllByRole("button", { name: "Close terminals and ports of settled threads" })).toHaveLength(1);
  });
});

describe("AC8: the dialog", () => {
  it("previews the settled threads for all projects, with terminals, ports and the warnings", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview() } } });
    await openDialog(m);
    expect(calls(m, "previewClean").map((call) => call.input)).toEqual([{ projectIds: [] }]);
    const box = dialog();
    expect(within(box).getByText("Clean settled resources?")).toBeTruthy();
    const first = box.querySelector<HTMLElement>("[data-clean-thread=a]")!;
    expect(first.textContent).toContain("Dev server");
    expect(first.textContent).toContain("2 terminals");
    expect(first.textContent).toContain(":5173 node, :3000");
    expect(box.querySelector("[data-clean-thread=b]")!.textContent).toContain("1 terminal");
    expect(box.textContent).toContain("This closes terminals even if you typed into them.");
    expect(box.textContent).toContain("A port process may need time to exit after its shutdown request.");
    expect(within(box).getByRole("button", { name: "Clean resources" })).toBeTruthy();
  });

  it("previews the list's project scope", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview() } } });
    fireEvent.click(screen.getByRole("button", { name: /Project scope/ }));
    fireEvent.click(within(await screen.findByRole("listbox", { name: "Projects" })).getByRole("option", { name: "Beta" }));
    await flush();
    await openDialog(m);
    expect(calls(m, "previewClean").map((call) => call.input)).toEqual([{ projectIds: ["proj_b"] }]);
  });

  it("previews every project in a scope of several", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview() } } });
    fireEvent.click(screen.getByRole("button", { name: /Project scope/ }));
    const listbox = await screen.findByRole("listbox", { name: "Projects" });
    fireEvent.click(within(listbox).getByRole("option", { name: "Beta" }));
    fireEvent.click(within(listbox).getByRole("option", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await flush();
    await openDialog(m);
    expect(calls(m, "previewClean").map((call) => call.input)).toEqual([{ projectIds: ["proj_b", "proj_a"] }]);
  });

  it("opens a thread from its Open button and closes the dialog", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview() } } });
    await openDialog(m);
    await press("Open Beta thread");
    expect(m.view.navigateCalls).toEqual([{ method: "toThread", threadId: "b" }]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls(m, "runClean")).toHaveLength(0);
  });

  it("says when nothing is found, with no Clean resources button", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview(false) } } });
    await openDialog(m);
    expect(within(dialog()).getByText(CLEAN_NOTHING_TEXT)).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Clean resources" })).toBeNull();
    await press("Close");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("runs the preview once on Clean resources, shows Cleaning... meanwhile, and reports in the dialog and a toast", async () => {
    let finish!: (value: unknown) => void;
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview(), runClean: () => new Promise((resolve) => (finish = resolve)) } } });
    await openDialog(m);
    await press("Clean resources");
    const busy = within(dialog()).getByRole("button", { name: "Cleaning..." }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => finish(result({ stillListening: [5173, 3000], issues: [{ threadId: "a", title: "Dev server", text: "could not close a terminal" }] })));
    await flush();
    expect(calls(m, "runClean").map((call) => call.input)).toEqual([{ token: "tok-1" }]);
    const box = dialog();
    expect(box.textContent).toContain("3 terminals closed · 1 port shutdown request sent");
    expect(box.textContent).toContain("Still listening after the request: :3000, :5173");
    expect(box.textContent).toContain("Dev server: could not close a terminal");
    expect(within(box).queryByRole("button", { name: "Clean resources" })).toBeNull();
    expect(toasts.success).toHaveBeenCalledWith("3 terminals closed · 1 port shutdown request sent", { description: "Still listening after the request: :3000, :5173" });
  });

  it("cannot be closed while it runs, and still reports in a toast when the list is gone before the answer", async () => {
    let finish!: (value: unknown) => void;
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview(), runClean: () => new Promise((resolve) => (finish = resolve)) } } });
    await openDialog(m);
    await press("Clean resources");
    expect((within(dialog()).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await flush();
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    cleanup();
    await act(async () => finish(result({ stillListening: [5173] })));
    expect(toasts.success).toHaveBeenCalledWith("3 terminals closed · 1 port shutdown request sent", { description: "Still listening after the request: :5173" });
  });

  it("closes on Escape when nothing runs", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview() } } });
    await openDialog(m);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await flush();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says No resources were closed. when nothing was", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview(), runClean: result({ closedTerminals: 0, portRequests: 0 }) } } });
    await openDialog(m);
    await press("Clean resources");
    expect(dialog().textContent).toContain("No resources were closed.");
    expect(toasts.success).toHaveBeenCalledWith("No resources were closed.", { description: undefined });
  });

  it("shows the expired text with Refresh preview, which previews again", async () => {
    const m = await mount({
      threads,
      server: { rows, answers: { previewClean: preview(), runClean: result({ expired: true, closedTerminals: 0, portRequests: 0 }) } },
    });
    await openDialog(m);
    await press("Clean resources");
    expect(within(dialog()).getByText(CLEAN_EXPIRED_TEXT)).toBeTruthy();
    expect(toasts.success).not.toHaveBeenCalled();
    await press("Refresh preview");
    expect(calls(m, "previewClean")).toHaveLength(2);
    expect(within(dialog()).getByRole("button", { name: "Clean resources" })).toBeTruthy();
    expect(within(dialog()).queryByText(CLEAN_EXPIRED_TEXT)).toBeNull();
  });

  it("shows a failed call's message in the dialog", async () => {
    const m = await mount({ threads, server: { rows } });
    m.server.failOnce("previewClean", "Preview is down");
    await openDialog(m);
    expect(within(dialog()).getByRole("alert").textContent).toBe("Preview is down");
    m.server.answer("previewClean", preview());
    await press("Refresh preview");
    m.server.failOnce("runClean", "Run is down");
    await press("Clean resources");
    expect(within(dialog()).getByRole("alert").textContent).toBe("Run is down");
  });

  it("previews afresh each time it opens", async () => {
    const m = await mount({ threads, server: { rows, answers: { previewClean: preview(false) } } });
    await openDialog(m);
    await press("Close");
    await openDialog(m);
    await waitFor(() => expect(calls(m, "previewClean")).toHaveLength(2));
  });
});
