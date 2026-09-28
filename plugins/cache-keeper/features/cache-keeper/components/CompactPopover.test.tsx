// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadView } from "@/src/core/view";
import { CompactPopover } from "./CompactPopover";

const call = vi.fn(async () => null as ThreadView | null);
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call }),
  useBbNavigate: () => ({ toThread: () => {} }),
}));

afterEach(cleanup);

const lines = [100_000, 150_000, 220_000, 400_000, null, null, null, null, null, null];
const never = lines.map(() => null);

const view = (over: Partial<ThreadView> = {}): ThreadView => ({
  threadId: "thr_1",
  title: "Build the page",
  eligible: true,
  status: "idle",
  hasPendingInteraction: false,
  compactOn: true,
  setting: 2,
  lines,
  line: 150_000,
  context: 312_000,
  window: 1_000_000,
  windowKnown: true,
  model: "claude-opus-5-5",
  lifetime: "1h",
  callsPerMessage: 3,
  callsMeasured: true,
  postCompaction: 40_000,
  postMeasured: false,
  priceOrigin: "bundled",
  rates: { w: 6.25e-6, r: 0.5e-6, o: 25e-6 },
  deadline: null,
  compactionDue: false,
  compactSkipped: false,
  compactedAt: null,
  canCompactNow: true,
  waiting: false,
  keptWarm: false,
  warmSetting: "switched",
  treeTop: { threadId: "thr_1", title: "Build the page" },
  warmPlanned: false,
  warmSkipped: false,
  nextWarmAt: null,
  warmNoPrice: false,
  counts: { threads: 0, commands: 0, subagents: 0, queued: 0, scheduled: 0 },
  decision: null,
  transcriptUnreadable: null,
  ...over,
});

/** Names each block of the popover, top to bottom, by what a person sees in it. */
function blocks(): string[] {
  const root = screen.getByRole("switch", { name: "Compact when idle" }).closest(".flex-col.gap-3.text-sm")!;
  return [...root.children].map((block) => {
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
    render(<CompactPopover view={view()} now={0} onChange={() => {}} />);
    expect(blocks()).toEqual(["keep warm", "compact when idle", "context bar", "status line", "details, closed"]);
    expect(screen.getByText("Now 312k · Idle")).toBeTruthy();
    expect(outsideFold("150k")).toEqual([screen.getByRole("button", { name: "150k" })]);
    expect(within(details()).getByText(/claude-opus-5-5 · 1 h cache · 3\.0 calls per message/)).toBeTruthy();
    expect(within(details()).getByText("Why 150k?")).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    expect(details().open).toBe(true);
  });

  it("shows a thread whose line is never with Why never? in its fold", () => {
    render(<CompactPopover view={view({ line: null, lines: never })} now={0} onChange={() => {}} />);
    expect(blocks()).toEqual(["keep warm", "compact when idle", "context bar", "status line", "details, closed"]);
    expect(screen.getByText("Now 312k · Idle, no line")).toBeTruthy();
    expect(within(details()).getByText("Why never?")).toBeTruthy();
    expect(screen.queryByText(/compact it just before|never compacted/)).toBeNull();
  });

  it("shows a thread below its tree top with Set on {tree top} under its greyed switch", () => {
    render(<CompactPopover view={view({ threadId: "thr_2", treeTop: { threadId: "thr_1", title: "Build the page" } })} now={0} onChange={() => {}} />);
    expect(blocks()).toEqual(["keep warm, set on its tree top", "compact when idle", "context bar", "status line", "details, closed"]);
    expect(screen.getByRole("switch", { name: "Keep warm while waiting" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Build the page" })).toBeTruthy();
  });

  it("hides the bar and the figures while the window is unknown, adding nothing in their place, and never says no price", () => {
    for (const rates of [null, view().rates]) {
      render(<CompactPopover view={view({ windowKnown: false, window: 0, line: null, lines: never, rates })} now={0} onChange={() => {}} />);
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
    render(<CompactPopover view={view()} now={0} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Compact when idle" }));
    expect(await screen.findByText("bb refused the change")).toBeTruthy();
    expect(blocks().at(-1)).toBe("other: bb refused the change");
  });
});
