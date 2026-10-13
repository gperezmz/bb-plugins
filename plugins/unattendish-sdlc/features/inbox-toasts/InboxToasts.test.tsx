// @vitest-environment jsdom
import type { ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/testing/sdk";
import { INBOX_NEW } from "@/shared/client";
import { clearComposerRequests, useComposerRequest } from "@/shared/composer-request";
import { drawnIcons, drawnLogos, expectIconsResolve } from "@/testing/icons";
import { InboxToasts } from "./index";

const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));
vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());

beforeEach(() => {
  sdk.reset();
  toast.mockClear();
  clearComposerRequests();
});

/** The composer request waiting now, read the way the Fleets page reads it. */
function waitingRequest() {
  let seen: ReturnType<typeof useComposerRequest> = null;
  function Probe() {
    seen = useComposerRequest();
    return null;
  }
  render(<Probe />);
  return seen;
}
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
    expect(toast.mock.calls[0]![0]).toBe("ENG-212 which locale wins?");
    sdk.emit(INBOX_NEW, { ...signal, rowId: "row_2", ref: "#7" });
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("leads a toast's line with the forge's logo: GitHub's, or GitLab's in place of the word GitLab", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, signal);
    sdk.emit(INBOX_NEW, { ...signal, rowId: "row_2", forge: "gitlab" });
    const lines = toast.mock.calls.map((call) => render((call[1] as { description: ReactElement }).description).baseElement);
    expect(drawnIcons(lines[0]!)).toContain("GithubLogo");
    expect(drawnLogos(lines[1]!)).toEqual(["gitlab"]);
    expect(lines[1]!.textContent).not.toContain("GitLab");
  });

  it("identifies a toast by its row, so one row raises one toast", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, signal);
    sdk.emit(INBOX_NEW, signal);
    expect(toast.mock.calls[1]![1]).toEqual(expect.objectContaining({ id: (toast.mock.calls[0]![1] as { id: string }).id }));
  });

  it("raises a toast for each fleet whose new row has the same id, each naming its fleet", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, { ...signal, fleet: "org/a", ref: "#7", rowId: "#7|answer|2026-10-12T09:30:00Z" });
    sdk.emit(INBOX_NEW, { ...signal, fleet: "org/b", ref: "#7", rowId: "#7|answer|2026-10-12T09:30:00Z" });
    const ids = toast.mock.calls.map((call) => (call[1] as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
    const lines = toast.mock.calls.map((call) => render((call[1] as { description: ReactElement }).description).baseElement.textContent);
    expect(lines.some((line) => line?.includes("org/a"))).toBe(true);
    expect(lines.some((line) => line?.includes("org/b"))).toBe(true);
  });

  it.each([
    ["answer", "Answer…"],
    ["grant", "Grant…"],
    ["ready", "Open Fleets"],
    ["other", "Open Fleets"],
  ])("labels the button of a row waiting for %s %s, which opens the Fleets page (AC1)", (waitsFor, label) => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, { ...signal, waitsFor });
    const { action } = toast.mock.calls[0]![1] as { action: { label: string; onClick(): void } };
    expect(action.label).toBe(label);
    action.onClick();
    expect(sdk.navigate.toPluginPanel).toHaveBeenCalledWith("fleets");
  });

  it.each(["answer", "grant"])("asks the Fleets page for the row's composer from the button of a row waiting for %s, naming its fleet and row (AC2)", (waitsFor) => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, { ...signal, waitsFor, fleet: "org/b", ref: "#7", what: "Which cache to use", rowId: "row_7" });
    (toast.mock.calls[0]![1] as { action: { onClick(): void } }).action.onClick();
    expect(waitingRequest()).toEqual(expect.objectContaining({ fleet: "org/b", rowId: "row_7", ref: "#7", what: "Which cache to use" }));
  });

  it("asks for no composer from Open Fleets", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, { ...signal, waitsFor: "ready" });
    (toast.mock.calls[0]![1] as { action: { onClick(): void } }).action.onClick();
    expect(waitingRequest()).toBeNull();
  });

  it("leads with the kind's icon, and says under the title which fleet waits for what, with its logo", () => {
    render(<InboxToasts />);
    sdk.emit(INBOX_NEW, { ...signal, ref: "#7", what: "Which cache to use", fleet: "org/dash" });
    const [title, options] = toast.mock.calls[0]! as [string, { icon: ReactElement; description: ReactElement }];
    expect(title).toBe("#7 Which cache to use");
    const icon = render(options.icon);
    expect(drawnIcons(icon.baseElement)).toEqual(["MessageSquare"]);
    const line = render(options.description);
    expect(line.baseElement.textContent).toBe("org/dash waits for your answer");
    expect(line.getByRole("img", { name: "GitHub" })).toBeTruthy();
    expectIconsResolve([...drawnIcons(icon.baseElement), ...drawnIcons(line.baseElement)]);
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
