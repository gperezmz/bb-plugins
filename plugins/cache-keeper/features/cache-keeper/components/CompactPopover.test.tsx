// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadView } from "@/src/core/view";
import { lines, view as viewOf } from "../model/view.test.helpers";
import { CompactPopover } from "./CompactPopover";

const call = vi.fn(async () => null as ThreadView | null);
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call }),
  useBbNavigate: () => ({ toThread: () => {} }),
}));

afterEach(cleanup);

const never = lines.map(() => null);

/** A tree top with a line at 150k, idle at 312k. */
const view = (over: Partial<ThreadView> = {}) => viewOf({ treeTop: { threadId: "thr_a", title: "a" }, context: 312_000, ...over });

function show(v: ThreadView): void {
  render(<CompactPopover view={v} now={0} onChange={() => {}} />);
}

/** Names each block of the popover, top to bottom, by what a person sees in it. */
function blocks(): string[] {
  return [...document.body.firstElementChild!.firstElementChild!.children].map((block) => {
    const el = block as HTMLElement;
    const inBlock = within(el);
    if (inBlock.queryByRole("switch", { name: "Keep warm while waiting" }) !== null) {
      return el.textContent!.includes("Set on") ? "keep warm, set on its tree top" : "keep warm";
    }
    if (inBlock.queryByRole("switch", { name: "Compact when idle" }) !== null) return "compact when idle";
    if (inBlock.queryByRole("slider", { name: "Compaction line" }) !== null) return "context bar";
    if (el.tagName === "DETAILS") return (el as HTMLDetailsElement).open ? "details, open" : "details, closed";
    if (el.textContent!.startsWith("Now ")) return "status line";
    return `other: ${el.textContent}`;
  });
}

const details = () => screen.getByText("Details").closest("details")!;
const outsideFold = (text: string) =>
  screen.queryAllByText((_, el) => el !== null && el.children.length === 0 && el.textContent!.includes(text)).filter((el) => el.closest("details") === null);

describe("the popover", () => {
  it("shows a thread with a line as the switches, the bar, the status line and a closed Details fold, the line only on the handle", () => {
    show(view());
    expect(blocks()).toEqual(["keep warm", "compact when idle", "context bar", "status line", "details, closed"]);
    expect(screen.getByText("Now 312k · Idle")).toBeTruthy();
    expect(outsideFold("150k")).toEqual([screen.getByRole("button", { name: "150k" })]);
    expect(within(details()).getByText(/claude-opus-5-5 · 1 h cache · 3\.0 calls per message/)).toBeTruthy();
    expect(within(details()).getByText("Why 150k?")).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    expect(details().open).toBe(true);
  });

  it("shows a thread whose line is never with Why never? in its fold", () => {
    show(view({ line: null, lines: never }));
    expect(blocks()).toEqual(["keep warm", "compact when idle", "context bar", "status line", "details, closed"]);
    expect(screen.getByText("Now 312k · Idle, no line")).toBeTruthy();
    expect(within(details()).getByText("Why never?")).toBeTruthy();
    expect(screen.queryByText(/compact it just before|never compacted/)).toBeNull();
  });

  it("shows a thread below its tree top with Set on {tree top} under its greyed switch", () => {
    show(view({ treeTop: { threadId: "thr_1", title: "Build the page" } }));
    expect(blocks()).toEqual(["keep warm, set on its tree top", "compact when idle", "context bar", "status line", "details, closed"]);
    expect(screen.getByRole("switch", { name: "Keep warm while waiting" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Build the page" })).toBeTruthy();
  });

  it("hides the bar and the figures while the window is unknown, adding nothing in their place, and never says no price", () => {
    for (const rates of [null, view().rates]) {
      show(view({ windowKnown: false, window: 0, line: null, lines: never, rates }));
      expect(blocks()).toEqual(["keep warm", "compact when idle", "status line", "details, closed"]);
      expect(screen.getByText("Now 312k · Idle, no line")).toBeTruthy();
      expect(within(details()).getByText(/claude-opus-5-5 · 1 h cache/)).toBeTruthy();
      expect(within(details()).queryByText(/^Why /)).toBeNull();
      expect(screen.queryByText(/price/)).toBeNull();
      cleanup();
    }
  });

  it("shows the error line last, only once an action has failed", async () => {
    call.mockRejectedValueOnce(new Error("bb refused the change"));
    show(view());
    fireEvent.click(screen.getByRole("switch", { name: "Compact when idle" }));
    expect(await screen.findByText("bb refused the change")).toBeTruthy();
    expect(blocks().at(-1)).toBe("other: bb refused the change");
  });

  it("offers Skip this wait while the thread waits and is kept warm, doing what the banner's Skip did", () => {
    call.mockClear();
    show(view({ waiting: true, warmPlanned: true }));
    expect(blocks()[0]).toBe("keep warm");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip this wait" }));
    expect(call).toHaveBeenCalledWith("skip", { threadId: "thr_a", what: "warm", undo: false });
  });

  it("offers Undo for the rest of a skipped wait, doing what the banner's Undo did", () => {
    call.mockClear();
    show(view({ waiting: true, warmSkipped: true }));
    expect(screen.getByText("Skipped for this wait")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip this wait" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(call).toHaveBeenCalledWith("skip", { threadId: "thr_a", what: "warm", undo: true });
  });

  it("offers Keep warm below a tree top whose tree is not switched on, switching its tree top on", () => {
    call.mockClear();
    show(view({ waiting: true, keptWarm: false, treeTop: { threadId: "thr_1", title: "Build the page" } }));
    expect(blocks()[0]).toBe("keep warm, set on its tree top");
    fireEvent.click(screen.getByRole("button", { name: "Keep warm" }));
    expect(call).toHaveBeenCalledWith("setKeepWarm", { threadId: "thr_a", on: true });
  });

  it("offers no Keep warm button on a tree top, under Never, or while the thread is not waiting", () => {
    for (const over of [
      { waiting: true, keptWarm: false },
      { waiting: true, keptWarm: false, warmSetting: "never" as const, treeTop: { threadId: "thr_1", title: "Build the page" } },
      { keptWarm: false, treeTop: { threadId: "thr_1", title: "Build the page" } },
    ]) {
      show(view(over));
      expect(screen.queryByRole("button", { name: "Keep warm" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Skip this wait" })).toBeNull();
      cleanup();
    }
  });

  it("shows an error from Skip this wait in the popover", async () => {
    call.mockRejectedValueOnce(new Error("bb refused the skip"));
    show(view({ waiting: true, warmPlanned: true }));
    fireEvent.click(screen.getByRole("button", { name: "Skip this wait" }));
    expect(await screen.findByText("bb refused the skip")).toBeTruthy();
    expect(blocks().at(-1)).toBe("other: bb refused the skip");
  });
});
