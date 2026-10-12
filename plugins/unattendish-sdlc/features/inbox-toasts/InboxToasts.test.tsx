// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/testing/sdk";
import { INBOX_NEW } from "@/shared/client";
import { InboxToasts } from "./index";

const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));
vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());

beforeEach(() => {
  sdk.reset();
  toast.mockClear();
});
afterEach(cleanup);

const signal = { fleet: "acme/web", ref: "ENG-212", what: "which locale wins?", rowId: "row_1", waitsFor: "answer", forge: "github" };

describe("the Inbox toasts", () => {
  it("toasts nothing on mount", () => {
    render(<InboxToasts />);
    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts nothing when the connection drops and returns", () => {
    render(<InboxToasts />);
    sdk.setConnection("reconnecting");
    sdk.setConnection("connected");
    expect(toast).not.toHaveBeenCalled();
  });

  it("still toasts a signal that arrives after the connection returned", () => {
    render(<InboxToasts />);
    sdk.setConnection("reconnecting");
    sdk.setConnection("connected");
    sdk.emit(INBOX_NEW, signal);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("toasts once per signal, naming the fleet and the row", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, signal);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0]).toBe("acme/web waits on you — ENG-212 which locale wins?");
    sdk.emit(INBOX_NEW, { ...signal, rowId: "row_2", ref: "#7" });
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("identifies a toast by its row, so one row raises one toast", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, signal);
    expect(toast.mock.calls[0]![1]).toMatchObject({ id: "row_1" });
  });

  it("opens the Fleets page from the toast's action", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, signal);
    const { action } = toast.mock.calls[0]![1] as { action: { label: string; onClick(): void } };
    expect(action.label).toBe("Open Fleets");
    action.onClick();
    expect(sdk.navigate.toPluginPanel).toHaveBeenCalledWith("fleets");
  });

  it("ignores a payload that is not the signal", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, { nonsense: true });
    expect(toast).not.toHaveBeenCalled();
  });

  it("draws nothing", () => {
    const view = render(<InboxToasts />);
    expect(view.baseElement.textContent).toBe("");
  });
});
