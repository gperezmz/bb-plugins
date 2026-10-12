// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { actionRecord, ago, inboxRow, MINUTE, NOW, unreadableInboxRow } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { setCompactViewport } from "@/testing/viewport";
import { clearFleetTabWishes, takeFleetTab } from "../pending-open";
import { InboxTable } from "./InboxTable";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

const refetch = vi.fn(async () => {});

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  refetch.mockClear();
  setCompactViewport(false);
});
afterEach(() => {
  cleanup();
  clearFleetTabWishes();
});

function show(rows = [inboxRow()], unreadable = [] as ReturnType<typeof unreadableInboxRow>[], showFleet = true) {
  return render(<InboxTable rows={rows} unreadable={unreadable} now={NOW} showFleet={showFleet} refetch={refetch} />);
}

describe("the Inbox table", () => {
  it("says nothing waits when there is no row", () => {
    show([], []);
    expect(screen.getByText("Nothing waits on you")).toBeTruthy();
  });

  it("lists a row's fleet, what it is, what it waits for, how long, its link and its action", () => {
    show();
    const row = screen.getByRole("row", { name: /ENG-212 which locale wins\?/ });
    expect(within(row).getByText("acme/web")).toBeTruthy();
    expect(within(row).getByText("your answer")).toBeTruthy();
    expect(within(row).getByText("5m")).toBeTruthy();
    expect(within(row).getByRole("link", { name: /ENG-212/ }).getAttribute("href")).toBe("https://linear.test/ENG-212");
    expect(within(row).getByRole("button", { name: "Answer… ENG-212" })).toBeTruthy();
  });

  it("gives a row waiting for something else its link and no action", () => {
    show([inboxRow({ waitsFor: "other", offer: null })]);
    const row = screen.getByRole("row", { name: /ENG-212/ });
    expect(within(row).getByRole("link")).toBeTruthy();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("opens the thread of a message link", () => {
    show([inboxRow({ managerThreadId: "thr_acme", link: { kind: "message", message: { threadId: "thr_old", message: 3, at: ago(MINUTE) } } })]);
    fireEvent.click(screen.getByRole("button", { name: /message 3/ }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_old");
  });

  it("lists an unreadable row with its fleet and the column, and opens that fleet's Fleet tab", () => {
    show([], [unreadableInboxRow({ fleet: "org/tickets", managerThreadId: "thr_tickets", reason: 'the table has no "Waits for" column' })]);
    expect(screen.getByText("org/tickets")).toBeTruthy();
    expect(screen.getByText(/unreadable: the table has no "Waits for" column/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the Fleet tab of org/tickets" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_tickets");
    expect(takeFleetTab("thr_tickets")).toBe(true);
  });

  it("leaves out the Fleet column on a fleet's own tab", () => {
    show([inboxRow()], [], false);
    expect(screen.queryByRole("columnheader", { name: "Fleet" })).toBeNull();
  });
});

describe("on a compact viewport", () => {
  it("stacks each row's fleet, what and wait above its action", () => {
    setCompactViewport(true);
    show();
    expect(screen.queryByRole("table")).toBeNull();
    const item = screen.getByRole("listitem");
    expect(item.className).toContain("flex-col");
    const text = item.textContent ?? "";
    expect(text.indexOf("acme/web")).toBeLessThan(text.indexOf("ENG-212 which locale wins?"));
    expect(text.indexOf("waits for your answer · 5m")).toBeLessThan(text.indexOf("Answer…"));
  });
});

describe("what a row shows after an action", () => {
  it("shows sent with its age and no action once the server holds one", () => {
    show([inboxRow({ offer: null, action: actionRecord({ sentAt: ago(3 * MINUTE) }) })]);
    expect(screen.getByText("sent · 3m")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows done once a poll saw the result", () => {
    show([inboxRow({ offer: null, action: actionRecord({ state: "done", doneAt: NOW }) })]);
    expect(screen.getByText("done")).toBeTruthy();
  });
});

describe("Answer…", () => {
  const open = () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Answer… ENG-212" }));
    return screen.getByRole("textbox", { name: "Your answer for ENG-212" }) as HTMLTextAreaElement;
  };

  it("opens a composer showing the row's What and a link to the park", () => {
    open();
    const composer = screen.getByRole("textbox").closest("div")!.parentElement!;
    expect(within(composer).getByText("ENG-212 which locale wins?")).toBeTruthy();
    expect(within(composer).getByRole("link", { name: /ENG-212/ }).getAttribute("href")).toBe("https://linear.test/ENG-212");
  });

  it("sends nothing while the text is empty", () => {
    const field = open();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(fake.api.sendAction).not.toHaveBeenCalled();
  });

  it("sends the text of several lines on Ctrl+Enter, then shows the row as sent, from the server's view", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord() });
    const view = show();
    // The refetch brings the row back carrying the action the server kept.
    refetch.mockImplementationOnce(async () => {
      view.rerender(<InboxTable rows={[inboxRow({ offer: null, action: actionRecord({ sentAt: ago(0) }) })]} unreadable={[]} now={NOW} showFleet refetch={refetch} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Answer… ENG-212" }));
    const field = screen.getByRole("textbox", { name: "Your answer for ENG-212" });
    fireEvent.change(field, { target: { value: "en-GB\nbecause the spec says so" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "answer", text: "en-GB\nbecause the spec says so" });
    expect(await screen.findByText("sent · 0s")).toBeTruthy();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Answer/ })).toBeNull();
  });

  it("sends on ⌘+Enter too", () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord() });
    const field = open();
    fireEvent.change(field, { target: { value: "yes" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    expect(fake.api.sendAction).toHaveBeenCalledTimes(1);
  });

  it("sends from the Send button", () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord() });
    const field = open();
    fireEvent.change(field, { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(fake.api.sendAction).toHaveBeenCalledTimes(1);
  });

  it("is cancelled with Esc", () => {
    const field = open();
    fireEvent.change(field, { target: { value: "yes" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(fake.api.sendAction).not.toHaveBeenCalled();
  });

  it("shows not sent with bb's reason, keeps the action, and keeps the composer's text", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: false, reason: "the manager thread is archived" });
    const field = open();
    fireEvent.change(field, { target: { value: "en-GB" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(await screen.findByText("not sent")).toBeTruthy();
    expect(screen.getByText("the manager thread is archived")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer… ENG-212" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Your answer for ENG-212" }) as HTMLTextAreaElement).value).toBe("en-GB");
  });
});

describe("Grant…, Build it and Re-grant", () => {
  it("Grant… opens a composer and sends the text as a grant", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord({ kind: "grant" }) });
    show([inboxRow({ waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: false } })]);
    fireEvent.click(screen.getByRole("button", { name: "Grant… ENG-212" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your grant for ENG-212" }), { target: { value: "merge it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "grant", text: "merge it" });
    await screen.findByText("sent · 0s");
  });

  it("Build it sends in one click, with no text", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord({ kind: "build" }) });
    show([inboxRow({ waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } })]);
    fireEvent.click(screen.getByRole("button", { name: "Build it ENG-212" }));
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "build" });
    await screen.findByText("sent · 0s");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers Re-grant beside Grant… and sends it in one click", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord({ kind: "grant" }) });
    show([inboxRow({ waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: true } })]);
    expect(screen.getByRole("button", { name: "Grant… ENG-212" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Re-grant ENG-212" }));
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "grant", regrant: true });
    await screen.findByText("sent · 0s");
  });

  it("offers no Re-grant on a plain grant row", () => {
    show([inboxRow({ waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: false } })]);
    expect(screen.queryByRole("button", { name: /Re-grant/ })).toBeNull();
  });
});
