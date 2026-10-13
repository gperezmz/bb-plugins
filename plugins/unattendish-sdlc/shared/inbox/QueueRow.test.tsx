// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxRowView } from "@/src/fleet/application/views";
import { fake, resetFakeApi } from "@/testing/api";
import { actionRecord, ago, inboxRow, MINUTE, NOW } from "@/testing/fixtures";
import { drawnIcons } from "@/testing/icons";
import { expectGrantLook } from "@/testing/look";
import { sdk } from "@/testing/sdk";
import { QueueRow } from "./QueueRow";
import { useRowActions } from "./use-row-action";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

const refetch = vi.fn(async () => {});

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  refetch.mockClear();
});
afterEach(cleanup);

/** Rows as the Fleets page and the Fleet tab hold them: one action state for the list, which outlives a row's layout. */
function Rows({ rows, layout }: { rows: readonly InboxRowView[]; layout: "columns" | "two-line" }) {
  const stateOf = useRowActions(refetch);
  return (
    <ul>
      {rows.map((row) => (
        <QueueRow key={row.id} row={row} now={NOW} fleet={undefined} showFleet={false} layout={layout} touch={false} state={stateOf(row)} />
      ))}
    </ul>
  );
}

function show(rows = [inboxRow()], layout: "columns" | "two-line" = "columns") {
  return render(<Rows rows={rows} layout={layout} />);
}

/** The row as the server's view shows it after it recorded the action: sent 7 minutes ago, the offer gone. */
const sentOnServer = (row: InboxRowView): InboxRowView => ({ ...row, offer: null, action: actionRecord({ kind: row.offer?.kind ?? "answer", sentAt: ago(7 * MINUTE) }) });

/** The next refetch brings back the row as the server shows it. */
function serverRecordsTheAction(view: ReturnType<typeof show>, row = inboxRow()) {
  refetch.mockImplementationOnce(async () => {
    view.rerender(<Rows rows={[sentOnServer(row)]} layout="columns" />);
  });
}

describe("Answer…", () => {
  const open = () => {
    fireEvent.click(screen.getByRole("button", { name: "Answer… ENG-212" }));
    return screen.getByRole("textbox", { name: "Your answer for ENG-212" }) as HTMLTextAreaElement;
  };

  it("sends nothing while the text is empty", () => {
    show();
    const field = open();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(fake.api.sendAction).not.toHaveBeenCalled();
  });

  it("sends the text of several lines on Ctrl+Enter, and shows the row as sent from the server's view", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord({ sentAt: ago(0) }) });
    const view = show();
    serverRecordsTheAction(view);
    const field = open();
    fireEvent.change(field, { target: { value: "en-GB\nbecause the spec says so" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "answer", text: "en-GB\nbecause the spec says so" });
    expect(await screen.findByText("sent · 7m")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Answer/ })).toBeNull();
  });

  it("sends on ⌘+Enter too", () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord() });
    show();
    const field = open();
    fireEvent.change(field, { target: { value: "yes" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    expect(fake.api.sendAction).toHaveBeenCalledTimes(1);
  });

  it("shows sending… while the call is in flight and sent only once bb accepted the message", async () => {
    let accept: (value: Awaited<ReturnType<typeof fake.api.sendAction>>) => void = () => {};
    fake.api.sendAction.mockReturnValue(new Promise((resolve) => (accept = resolve)));
    const view = show();
    serverRecordsTheAction(view);
    const field = open();
    fireEvent.change(field, { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("sending…")).toBeTruthy();
    expect(screen.queryByText(/^sent/)).toBeNull();
    await act(async () => accept({ ok: true, action: actionRecord({ sentAt: ago(0) }) }));
    expect(await screen.findByText("sent · 7m")).toBeTruthy();
  });

  it("is cancelled with Esc, which discards the draft: reopening starts empty", () => {
    show();
    const field = open();
    fireEvent.change(field, { target: { value: "en-GB" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(fake.api.sendAction).not.toHaveBeenCalled();
    expect(open().value).toBe("");
  });

  it("discards the draft on Cancel too", () => {
    show();
    fireEvent.change(open(), { target: { value: "en-GB" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(open().value).toBe("");
  });

  it("says Not sent with bb's reason in the composer's footer, keeping the text and the action", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: false, reason: "the manager thread is archived" });
    show();
    const field = open();
    fireEvent.change(field, { target: { value: "en-GB" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect((await screen.findByRole("alert")).textContent).toBe("Not sent: the manager thread is archived");
    expect(screen.queryByText(/^sent/)).toBeNull();
    expect((screen.getByRole("textbox", { name: "Your answer for ENG-212" }) as HTMLTextAreaElement).value).toBe("en-GB");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Answer… ENG-212" })).toBeTruthy();
  });

  it("says the result is unknown when the call fails, and lets the server's view decide", async () => {
    fake.api.sendAction.mockRejectedValue(new Error("connection dropped"));
    const view = show();
    serverRecordsTheAction(view);
    const field = open();
    fireEvent.change(field, { target: { value: "en-GB" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(await screen.findByText("sent · 7m")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the text, and then offers the action again beside the unknown result, when the failed call left no record", async () => {
    fake.api.sendAction.mockRejectedValue(new Error("connection dropped"));
    show();
    const field = open();
    fireEvent.change(field, { target: { value: "en-GB" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(await screen.findByText("composing…")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Your answer for ENG-212" }) as HTMLTextAreaElement).value).toBe("en-GB");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Answer… ENG-212" })).toBeTruthy();
    expect(screen.getByLabelText("could not confirm whether the last send went through")).toBeTruthy();
  });

  it("keeps the composer, its text and sending… when the row changes layout", async () => {
    fake.api.sendAction.mockReturnValue(new Promise(() => {}));
    const view = show();
    const field = open();
    fireEvent.change(field, { target: { value: "en-GB\nso" } });
    view.rerender(<Rows rows={[inboxRow()]} layout="two-line" />);
    expect((screen.getByRole("textbox", { name: "Your answer for ENG-212" }) as HTMLTextAreaElement).value).toBe("en-GB\nso");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("sending…");
    view.rerender(<Rows rows={[inboxRow()]} layout="columns" />);
    expect(screen.getByText("sending…")).toBeTruthy();
  });
});

describe("Grant…, Build it and Re-grant", () => {
  const grantRow = (regrant: boolean) => inboxRow({ waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant } });

  it("Grant… opens a composer and sends the text as a grant", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord({ kind: "grant", sentAt: ago(0) }) });
    const row = grantRow(false);
    const view = show([row]);
    serverRecordsTheAction(view, row);
    fireEvent.click(screen.getByRole("button", { name: "Grant… ENG-212" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your grant for ENG-212" }), { target: { value: "merge it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "grant", text: "merge it" });
    expect(await screen.findByText("sent · 7m")).toBeTruthy();
  });

  it("Build it sends in one click, with no text", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord({ kind: "build", sentAt: ago(0) }) });
    const row = inboxRow({ waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } });
    const view = show([row]);
    serverRecordsTheAction(view, row);
    fireEvent.click(screen.getByRole("button", { name: "Build it ENG-212" }));
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "build" });
    expect(await screen.findByText("sent · 7m")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers Re-grant beside Grant… and sends it in one click as a re-grant", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: true, action: actionRecord({ kind: "grant", sentAt: ago(0) }) });
    const row = grantRow(true);
    const view = show([row]);
    serverRecordsTheAction(view, row);
    expect(screen.getByRole("button", { name: "Grant… ENG-212" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Re-grant ENG-212" }));
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "grant", regrant: true });
    expect(await screen.findByText("sent · 7m")).toBeTruthy();
  });

  it.each(["columns", "two-line"] as const)("draws Re-grant as Grant… is in the %s layout: an outlined purple button in medium weight, with a redo icon of its own (AC1)", (layout) => {
    show([grantRow(true)], layout);
    const grant = screen.getByRole("button", { name: "Grant… ENG-212" });
    const regrant = screen.getByRole("button", { name: "Re-grant ENG-212" });
    for (const button of [grant, regrant]) expectGrantLook(button);
    // Squeezed to the row's narrowest, a label stays on one line: "Re-grant" would break at its hyphen (AC3).
    for (const button of [grant, regrant]) expect(button.className).toContain("whitespace-nowrap");
    expect(drawnIcons(grant)).toEqual(["GitMerge"]);
    expect(drawnIcons(regrant)).toEqual(["unattendish-sdlc/redo"]);
    expect(regrant.textContent).toBe("Re-grant");
  });

  it("offers no Re-grant on a plain grant row", () => {
    show([grantRow(false)]);
    expect(screen.queryByRole("button", { name: /Re-grant/ })).toBeNull();
  });
});
