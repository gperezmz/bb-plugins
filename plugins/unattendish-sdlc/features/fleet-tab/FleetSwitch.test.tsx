// @vitest-environment jsdom
// The Fleet tab of a thread holding more than one fleet (#270 AC1 to AC3, AC6, AC7).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetCardView, FleetDetailView, ProblemView } from "@/src/fleet/application/views";
import { clearReviewRequests, requestReview } from "@/shared/review-request";
import { clearShownFleets, showFleet } from "@/shared/shown-fleet";
import { refetchEveryView } from "@/shared/use-live";
import { fake, resetFakeApi } from "@/testing/api";
import { fleetCard, fleetDetail, managerFleet, managerFleets, unreadableInboxRow } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { setCompactViewport } from "@/testing/viewport";
import { FleetTab } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

const scrolled: Element[] = [];
const unreadable: ProblemView = { code: "unreadable-rows", text: "1 manifest row cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const flagged: ProblemView = { code: "manager-gone", text: "The manager thread is archived or gone", fix: { kind: "none" } };

let cards: Record<string, FleetCardView>;
const dash = (over: Partial<FleetCardView> = {}) => fleetCard({ repo: "org/dash", managerThreadId: "thr_a", waiting: 6, ...over });
const wake = (over: Partial<FleetCardView> = {}) => fleetCard({ repo: "org/wake", managerThreadId: "thr_a", waiting: 2, problems: [unreadable], ...over });

/** The thread holds `held`; each fleet's detail is built from its card, org/wake's with an unreadable Inbox row. */
const hold = (...held: FleetCardView[]) => {
  cards = Object.fromEntries(held.map((card) => [card.repo, card]));
  fake.api.threadFleet.mockResolvedValue(managerFleets(held));
};

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  setCompactViewport(false);
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  fake.api.fleetDetail.mockImplementation(async ({ repo }: { repo: string }) => {
    const card = cards[repo];
    if (card === undefined) return { ok: false, reason: `no fleet is registered for ${repo}` };
    const manifest: FleetDetailView["manifest"] =
      repo === "org/wake"
        ? { status: "ok", inbox: [], unreadableInbox: [unreadableInboxRow({ fleet: repo, line: 9 })], inFlight: [], blocked: [], landed: [], unreadable: [{ section: "Inbox", line: 9, reason: 'the table has no "Waits for" column' }], written: [] }
        : { status: "ok", inbox: [], unreadableInbox: [], inFlight: [], blocked: [], landed: [], unreadable: [], written: [] };
    return { ok: true, detail: fleetDetail({ card, manifest }) };
  });
  hold(dash(), wake());
});
afterEach(() => {
  cleanup();
  clearReviewRequests();
  clearShownFleets();
});

const open = async () => {
  await act(async () => {
    render(<FleetTab threadId="thr_a" />);
  });
};
const header = (repo: string) => screen.findByRole("banner", { name: `Fleet ${repo}` });
const switcher = () => screen.getByRole("button", { name: /switch fleet$/ });
const unreadableRow = () => screen.getByText(/Unreadable row, line 9/).closest("li")!;

describe("which fleet the tab shows (#270 AC2)", () => {
  it("opens on the first fleet in order, a problem before more rows waiting, with none remembered", async () => {
    await open();
    expect(await header("org/wake")).toBeTruthy();
  });

  it("stays on the fleet it shows as the counts change", async () => {
    await open();
    await header("org/wake");
    hold(dash({ problems: [flagged], waiting: 9 }), wake());
    await act(() => refetchEveryView());
    expect(await header("org/wake")).toBeTruthy();
  });

  it("remembers the fleet picked for the thread when the tab closes and opens again", async () => {
    await open();
    await header("org/wake");
    act(() => showFleet("thr_a", "org/dash"));
    await header("org/dash");
    cleanup();
    await open();
    expect(await header("org/dash")).toBeTruthy();
  });

  it("shows the first of the others once the fleet it shows is unregistered", async () => {
    const third = fleetCard({ repo: "org/zed", managerThreadId: "thr_a" });
    hold(dash(), wake(), third);
    await open();
    await header("org/wake");
    hold(dash(), third);
    await act(() => refetchEveryView());
    expect(await header("org/dash")).toBeTruthy();
  });

  it("shows the thread's first fleet when opened for one it does not hold", async () => {
    showFleet("thr_a", "org/gone");
    await open();
    expect(await header("org/wake")).toBeTruthy();
  });
});

describe("opening the tab for a named fleet (#270 AC1)", () => {
  it("switches the open tab to the fleet named, and back", async () => {
    await open();
    await header("org/wake");
    act(() => showFleet("thr_a", "org/dash"));
    expect(await header("org/dash")).toBeTruthy();
    act(() => showFleet("thr_a", "org/wake"));
    expect(await header("org/wake")).toBeTruthy();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("opens Work at the unreadable row when Review names the fleet, from another fleet's view", async () => {
    showFleet("thr_a", "org/dash");
    await open();
    await header("org/dash");
    act(() => {
      showFleet("thr_a", "org/wake");
      requestReview("thr_a", "org/wake");
    });
    await header("org/wake");
    await waitFor(() => expect(scrolled).toContain(unreadableRow()));
  });
});

describe("the switcher (#270 AC3)", () => {
  it("lists every fleet in order with its count and dot, marks the one shown, and shows the one picked in all four tabs", async () => {
    await open();
    await header("org/wake");
    fireEvent.click(switcher());
    const menu = screen.getByRole("menu", { name: "Fleets of this thread" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual(["org/wake, 2 waiting on you, has a problem", "org/dash, 6 waiting on you"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(within(items[0]!).getByText("2").className).toContain("text-warning-text");
    expect(items[0]!.querySelector(".rounded-full")!.className).toContain("bg-destructive");
    fireEvent.click(items[1]!);
    expect(await header("org/dash")).toBeTruthy();
    expect(fake.api.fleetDetail).toHaveBeenLastCalledWith({ repo: "org/dash" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens and picks from the keyboard, and Escape closes it", async () => {
    await open();
    await header("org/wake");
    fireEvent.keyDown(switcher(), { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(within(menu).getByRole("menuitemradio", { name: /^org\/wake/ }));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(switcher());
    fireEvent.keyDown(switcher(), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: /^org\/dash/ }));
    fireEvent.click(document.activeElement!);
    expect(await header("org/dash")).toBeTruthy();
  });

  it("is the fleet's name as plain text for a thread with one fleet (#270 AC3, AC7)", async () => {
    fake.api.threadFleet.mockResolvedValue(managerFleet(dash()));
    cards = { "org/dash": dash() };
    await open();
    const banner = await header("org/dash");
    expect(within(banner).getByText("org/dash").tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: /switch fleet$/ })).toBeNull();
  });
});

describe("a left-behind fleet in its tab (#270 AC6)", () => {
  it("says what its manifest now names in Work and Notes, and lists nothing of it", async () => {
    const left = fleetCard({ repo: "org/old", managerThreadId: "thr_a", problems: [{ code: "left-behind", text: "Its manifest now names org/wake, so nothing in it is this fleet's. Unregister it with `bb unattendish fleet unregister org/old`.", fix: { kind: "none" } }] });
    fake.api.threadFleet.mockResolvedValue(managerFleet(left));
    fake.api.fleetDetail.mockResolvedValue({ ok: true, detail: fleetDetail({ card: left, manifest: { status: "left-behind", names: "org/wake" } }) });
    await open();
    const banner = await header("org/old");
    expect(within(banner).getByText(/Unregister it with/)).toBeTruthy();
    expect(within(banner).queryByRole("button", { name: /^Review/ })).toBeNull();
    expect(screen.getAllByText("The manifest now names org/wake, so nothing in it is this fleet's.").length).toBeGreaterThanOrEqual(2);
  });
});
