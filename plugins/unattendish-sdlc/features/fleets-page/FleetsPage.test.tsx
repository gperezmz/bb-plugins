// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetCardView, ReasonView } from "@/src/fleet/application/views";
import { fake, resetFakeApi } from "@/testing/api";
import { actionRecord, ago, fleetCard, fleetsView, HOUR, inboxRow, MINUTE, unreadableInboxRow } from "@/testing/fixtures";
import { drawnIcons, expectIconsResolve } from "@/testing/icons";
import { sdk } from "@/testing/sdk";
import { setCompactViewport } from "@/testing/viewport";
import { BOARD_CHANGED } from "@/shared/client";
import { closeConnect, currentConnect } from "@/shared/connect/requests";
import { rememberFilter } from "./filter";
import { FleetsHeaderCount, FleetsPage } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  rememberFilter(null);
  setCompactViewport(false);
});
afterEach(() => {
  cleanup();
  closeConnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const missing: ReasonView = { code: "manifest-missing", text: "The manifest at /w/manifest.md does not exist yet", fix: { kind: "fleet-tab" } };
const unreadableRows: ReasonView = { code: "unreadable-rows", text: "2 manifest rows cannot be read: Inbox", fix: { kind: "fleet-tab" } };
const noForge: ReasonView = { code: "no-credential", text: "no GitHub account can read other-org", fix: { kind: "connect", role: "forge" } };
const noTracker: ReasonView = { code: "no-credential", text: "no Linear account can read team PLAT", fix: { kind: "connect", role: "tracker" } };

const fleet = (repo: string, over: Partial<FleetCardView> = {}) => fleetCard({ repo, managerThreadId: `thr_${repo}`, tracker: "forge-issues", ...over });

async function show(view = fleetsView()) {
  fake.api.fleets.mockResolvedValue(view);
  const page = render(<FleetsPage />);
  await screen.findByRole("region", { name: "Queue" }).catch(() => null);
  return page;
}

const board = () => screen.getByRole("region", { name: "Fleet board" });
const queue = () => screen.getByRole("region", { name: "Queue" });
const line = (repo: string) => within(board()).getByRole("listitem", { name: `Fleet ${repo}` });
const boardRepos = () => within(board()).getAllByRole("listitem").map((item) => item.getAttribute("aria-label")!.replace("Fleet ", ""));
const queueRows = () => within(within(queue()).getByRole("tabpanel")).queryAllByRole("listitem");

/** Focuses `element` and reads the tooltip its hover text shows. */
async function hoverText(element: HTMLElement): Promise<string> {
  act(() => element.focus());
  return (await screen.findByRole("tooltip")).textContent ?? "";
}

describe("the header count", () => {
  it("counts every Inbox row across fleets", async () => {
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 8 }));
    render(<FleetsHeaderCount />);
    expect((await screen.findByLabelText("8 waiting on you")).textContent).toBe("8");
  });

  it("shows no count at zero", async () => {
    render(<FleetsHeaderCount />);
    await waitFor(() => expect(fake.api.fleets).toHaveBeenCalled());
    expect(screen.queryByLabelText(/waiting on you/)).toBeNull();
  });

  it("follows the board when the server says it changed", async () => {
    fake.api.fleets.mockResolvedValueOnce(fleetsView({ waiting: 1 }));
    render(<FleetsHeaderCount />);
    await screen.findByLabelText("1 waiting on you");
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 2 }));
    sdk.emit(BOARD_CHANGED);
    await screen.findByLabelText("2 waiting on you");
  });

  it("shows how old the data is in an amber pill when a refresh fails, and reloads from it at once (AC14)", async () => {
    fake.api.fleets.mockResolvedValueOnce(fleetsView({ waiting: 1, generatedAt: new Date(Date.now() - 3 * MINUTE).toISOString() }));
    render(<FleetsHeaderCount />);
    await screen.findByLabelText("1 waiting on you");
    fake.api.fleets.mockRejectedValue(new Error("the server is not running"));
    sdk.emit(BOARD_CHANGED);
    const pill = await screen.findByLabelText("Couldn't refresh: the server is not running. Showing what was loaded 3m ago.");
    expect(pill.textContent).toBe("3m old");
    expect(pill.className).toContain("text-warning-text");
    expect(screen.getByLabelText("1 waiting on you")).toBeTruthy();
    expect(await hoverText(pill)).toContain("Couldn't refresh: the server is not running. Showing what was loaded 3m ago.");
    const calls = fake.api.fleets.mock.calls.length;
    fireEvent.click(within(pill).getByRole("button", { name: "Reload now" }));
    expect(fake.api.fleets.mock.calls.length).toBe(calls + 1);
  });
});

describe("reloading from the stale pill", () => {
  it("reloads the page too, not only the title bar", async () => {
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 1, fleets: [fleet("org/dash", { waiting: 1 })] }));
    render(
      <>
        <FleetsHeaderCount />
        <FleetsPage />
      </>,
    );
    await screen.findByRole("region", { name: "Fleet board" });
    fake.api.fleets.mockRejectedValue(new Error("the server is not running"));
    sdk.emit(BOARD_CHANGED);
    const pill = await screen.findByLabelText(/Couldn't refresh/);
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 1, fleets: [fleet("org/dash", { waiting: 1 }), fleet("org/wake", { waiting: 1 })] }));
    fireEvent.click(within(pill).getByRole("button", { name: "Reload now" }));
    await waitFor(() => expect(boardRepos()).toEqual(["org/dash", "org/wake"]));
    expect(screen.queryByLabelText(/Couldn't refresh/)).toBeNull();
  });
});

describe("the stale pill's age", () => {
  it("keeps up with the clock while it shows, not only when a fetch answers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const loaded = Date.now() - 3 * MINUTE;
    fake.api.fleets.mockResolvedValueOnce(fleetsView({ waiting: 1, generatedAt: new Date(loaded).toISOString() }));
    render(<FleetsHeaderCount />);
    await screen.findByLabelText("1 waiting on you");
    fake.api.fleets.mockRejectedValue(new Error("the server is not running"));
    sdk.emit(BOARD_CHANGED);
    expect((await screen.findByLabelText(/Couldn't refresh/)).textContent).toBe("3m old");
    vi.spyOn(Date, "now").mockReturnValue(loaded + 5 * MINUTE);
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByLabelText(/Couldn't refresh/).textContent).toBe("5m old");
  });
});

describe("the page's states (AC14)", () => {
  it("draws grey bars while it loads", () => {
    fake.api.fleets.mockReturnValue(new Promise(() => {}));
    render(<FleetsPage />);
    expect(screen.getByRole("status", { name: "Loading your fleets" })).toBeTruthy();
  });

  it("says it couldn't load, with the error, the retry note and Try again, which reloads at once", async () => {
    fake.api.fleets.mockRejectedValue(new Error("the server is not running"));
    render(<FleetsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your fleets");
    expect(alert.textContent).toContain("the server is not running");
    expect(alert.textContent).toContain("It tries again every 1 minute.");
    expect(drawnIcons(alert)).toEqual(["CloudOff"]);
    fake.api.fleets.mockResolvedValue(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })] }));
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Fleet board" })).toBeTruthy();
  });

  it("reloads the title bar too from Try again", async () => {
    fake.api.fleets.mockRejectedValue(new Error("the server is not running"));
    render(
      <>
        <header>
          <FleetsHeaderCount />
        </header>
        <FleetsPage />
      </>,
    );
    const alert = await screen.findByRole("alert");
    fake.api.fleets.mockResolvedValue(fleetsView({ waiting: 1, fleets: [fleet("org/dash", { waiting: 1 })] }));
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(screen.getByRole("banner")).findByLabelText("1 waiting on you")).toBeTruthy();
  });

  it("keeps the board and queue as they were when a refresh fails", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })], inbox: [inboxRow({ fleet: "org/dash" })] }));
    fake.api.fleets.mockRejectedValue(new Error("the server is not running"));
    sdk.emit(BOARD_CHANGED);
    await waitFor(() => expect(fake.api.fleets).toHaveBeenCalledTimes(2));
    expect(line("org/dash")).toBeTruthy();
    expect(queueRows()).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says no fleet is registered, and how one appears", async () => {
    const page = await show();
    expect(await screen.findByText("No fleet is registered")).toBeTruthy();
    expect(screen.getByText("/run-fleet")).toBeTruthy();
    expect(screen.getByText(/from unattendish-sdlc runs with this plugin installed\./)).toBeTruthy();
    expect(drawnIcons(page.baseElement)).toEqual(["unattendish-sdlc/fleet"]);
  });

  it("says calmly that nothing waits, keeping the tabs and what was sent in the last hour", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash")], recentActions: [actionRecord({ fleet: "org/dash", state: "done", doneAt: ago(5 * MINUTE) })] }));
    const panel = within(queue()).getByRole("tabpanel");
    expect(within(panel).getByText("Nothing waits on you")).toBeTruthy();
    expect(drawnIcons(panel)).toEqual(["CircleCheck"]);
    fireEvent.click(within(queue()).getByRole("tab", { name: /Sent/ }));
    expect(queueRows()).toHaveLength(1);
  });
});

describe("the page (AC1)", () => {
  it("is the board over one queue of every fleet's rows, with no cards, no needs list and no landed section", async () => {
    const fleets = [
      fleet("org/dash", { waiting: 3 }),
      fleet("org/wake", { waiting: 3 }),
      fleet("other-org/x", { waiting: 2, reasons: [noForge] }),
      fleet("acme/web"),
      fleet("acme/api"),
      fleet("acme/docs", { inFlight: 1 }),
    ];
    const inbox = ["org/dash", "org/dash", "org/dash", "org/wake", "org/wake", "org/wake", "other-org/x", "other-org/x"].map((repo, n) => inboxRow({ id: `r${n}`, fleet: repo, since: ago((n + 1) * MINUTE) }));
    await show(fleetsView({ waiting: 8, fleets, inbox, needsAccount: [{ fleet: "other-org/x", managerThreadId: "thr_other-org/x", role: "forge", text: "needs an account" }] }));
    expect(boardRepos()).toEqual(["other-org/x", "org/dash", "org/wake", "acme/docs"]);
    expect(queueRows()).toHaveLength(8);
    expect(within(queue()).getByRole("tab", { name: "All 8" })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("list", { name: "Needs an account" })).toBeNull();
    expect(screen.queryByText(/Recently landed/)).toBeNull();
  });

  it("draws only icons bb resolves (AC18)", async () => {
    const page = await show(
      fleetsView({
        fleets: [
          fleet("org/dash", { blocked: 1, inFlight: 2, waiting: 3, landed: 1, manager: { state: "working", since: null }, cost: { amount: 1, currency: "$", period: "p" } }),
          fleet("platform/infra", { tracker: "linear:PLAT", reasons: [noTracker], warnings: [{ kind: "never-polled" }], manager: { state: "none", since: null } }),
          fleet("org/gone", { forge: "gitlab", reasons: [missing, { code: "manager-gone", text: "gone", fix: { kind: "none" } }], warnings: [{ kind: "expires", label: "t", credentialId: "c", accountId: "a", role: "forge", expiresAt: ago(0), daysLeft: 1 }] }),
        ],
        inbox: [
          inboxRow({ id: "a", fleet: "org/dash", waitsFor: "answer" }),
          inboxRow({ id: "g", fleet: "org/dash", waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: true } }),
          inboxRow({ id: "b", fleet: "org/dash", waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } }),
          inboxRow({ id: "o", fleet: "org/dash", waitsFor: "other", offer: null }),
          inboxRow({ id: "d", fleet: "org/dash", offer: null, action: actionRecord({ state: "done" }) }),
        ],
        unreadableInbox: [unreadableInboxRow({ fleet: "org/dash" })],
      }),
    );
    const icons = drawnIcons(page.baseElement);
    expect(icons.length).toBeGreaterThan(15);
    expectIconsResolve(icons);
    fireEvent.click(within(queue()).getByRole("tab", { name: /Sent/ }));
    expectIconsResolve(drawnIcons(page.baseElement));
  });
});

describe("a board line (AC2–AC6)", () => {
  it("shows the forge's logo and the name, then the tracker's logo and key where the tracker is a service of its own", async () => {
    await show(fleetsView({ fleets: [fleet("platform/infra", { tracker: "linear:PLAT", waiting: 1 }), fleet("org/dash", { waiting: 1 })] }));
    const infra = line("platform/infra");
    const parts = [...infra.querySelectorAll("[role=img], button, span")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
    expect(parts.indexOf("GitHub")).toBeLessThan(parts.indexOf("platform/infra"));
    expect(within(infra).getByText("Linear")).toBeTruthy();
    expect(within(infra).getByText(/PLAT/)).toBeTruthy();
    expect(within(line("org/dash")).queryByText("Linear")).toBeNull();
  });

  it("names a GitLab forge, which has no logo to show", async () => {
    await show(fleetsView({ fleets: [fleet("group/billing", { forge: "gitlab", waiting: 1 })] }));
    expect(within(line("group/billing")).getByText("GitLab")).toBeTruthy();
  });

  it("leaves spend empty where it is unknown, and shows it where it is known", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1, cost: { amount: 4.2, currency: "$", period: "since this manager started" } }), fleet("org/wake", { waiting: 1, cost: null })] }));
    expect(within(line("org/dash")).getByText("$4.20")).toBeTruthy();
    expect(within(line("org/wake")).queryByText(/\$/)).toBeNull();
  });

  it("shows a working manager as a turning icon alone, and says so on hover", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1, manager: { state: "working", since: ago(HOUR) } })] }));
    const icon = within(line("org/dash")).getByRole("img", { name: "Manager working" });
    expect(icon.className).toContain("motion-safe:animate-spin");
    expect(icon.parentElement!.textContent).toBe("");
    expect(await hoverText(icon.parentElement!)).toBe("Manager working");
  });

  it("shows an idle manager as a cup with how long it has been idle", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1, manager: { state: "idle", since: ago(10 * MINUTE) } })] }));
    const icon = within(line("org/dash")).getByRole("img", { name: "Manager idle for 10m" });
    expect(drawnIcons(icon)).toEqual(["Coffee"]);
    expect(icon.parentElement!.textContent).toBe("10m");
  });

  it("shows a fleet with no manager in red, with no duration", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1, manager: { state: "none", since: null } })] }));
    const icon = within(line("org/dash")).getByRole("img", { name: /No manager/ });
    expect(icon.parentElement!.className).toContain("text-destructive-text");
    expect(icon.parentElement!.textContent).toBe("");
  });

  it("keeps the four Status slots in place, so org/wake's 1 sits under org/dash's 6", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { blocked: 1, inFlight: 2, waiting: 6, landed: 1 }), fleet("org/wake", { waiting: 1 })] }));
    const slotOf = (repo: string, label: string) => {
      const slot = within(line(repo)).getByLabelText(label);
      return [...slot.parentElement!.parentElement!.children].indexOf(slot.parentElement!);
    };
    expect(slotOf("org/dash", "6 waiting on you")).toBe(2);
    expect(slotOf("org/wake", "1 waiting on you")).toBe(2);
    expect(within(line("org/wake")).queryByLabelText(/blocked/)).toBeNull();
    expect(await hoverText(within(line("org/dash")).getByLabelText("6 waiting on you"))).toBe("6 waiting on you");
  });

  it("lists the four counts on the Status header's hover", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })] }));
    expect(await hoverText(within(board()).getByText("Status"))).toBe("Blocked · In flight · Waits on you · Landed in the last 7 days");
  });

  it("leaves polling empty while healthy, and says when it never ran or is late", async () => {
    await show(
      fleetsView({
        fleets: [
          fleet("org/ok", { waiting: 1 }),
          fleet("org/new", { waiting: 1, warnings: [{ kind: "never-polled" }] }),
          fleet("org/late", { waiting: 1, warnings: [{ kind: "polling-late", lastPolledAt: ago(9 * MINUTE) }] }),
        ],
      }),
    );
    expect(within(line("org/ok")).queryByText(/late|not yet/)).toBeNull();
    expect(within(line("org/new")).getByText("not yet")).toBeTruthy();
    expect(within(line("org/late")).getByText("9m late").className).toContain("text-warning-text");
  });

  it("marks a fleet with a missing manifest with a red bar and Review, which opens its Fleet tab", async () => {
    await show(fleetsView({ fleets: [fleet("org/gone", { reasons: [missing] })] }));
    const gone = line("org/gone");
    expect(gone.querySelector(".bg-destructive")).not.toBeNull();
    const review = within(gone).getByRole("button", { name: missing.text });
    expect(review.textContent).toBe("Review");
    fireEvent.click(review);
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_org/gone");
  });

  it("shows the first of several flags with how many more, every sentence on hover", async () => {
    await show(fleetsView({ fleets: [fleet("platform/infra", { tracker: "linear:PLAT", reasons: [noForge, noTracker, unreadableRows] })] }));
    const fix = within(line("platform/infra")).getByRole("button", { name: /2 manifest rows/ });
    expect(fix.textContent).toBe("Review +2");
    const text = await hoverText(fix);
    for (const reason of [noForge, noTracker, unreadableRows]) expect(text).toContain(reason.text);
  });

  it("offers Connect… in red where an account fixes it, which opens the Connect popup over the page", async () => {
    await show(fleetsView({ fleets: [fleet("other-org/x", { reasons: [noForge] })] }));
    const x = line("other-org/x");
    expect(x.querySelector(".bg-destructive")).not.toBeNull();
    const connect = within(x).getByRole("button", { name: "no GitHub account can read other-org" });
    expect(connect.textContent).toBe("Connect…");
    expect(connect.className).toContain("text-destructive-text");
    expect(await hoverText(connect)).toBe("no GitHub account can read other-org");
    fireEvent.click(connect);
    expect(currentConnect()?.request).toEqual({ target: { fleet: "other-org/x", role: "forge" } });
  });

  it("offers Renew… in amber for a token expiring soon, which opens the Connect popup to renew it", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { warnings: [{ kind: "expires", label: "GitHub · yuser for org", credentialId: "c1", accountId: "a1", role: "forge", expiresAt: ago(0), daysLeft: 3 }] })] }));
    const dash = line("org/dash");
    expect(dash.querySelector(".bg-warning")).not.toBeNull();
    fireEvent.click(within(dash).getByRole("button", { name: "GitHub · yuser for org: token expires in 3 days" }));
    expect(currentConnect()?.request).toEqual({ target: { fleet: "org/dash", role: "forge" }, account: "a1", replaces: "c1" });
  });

  it("shows a red ✕ for a gone manager, saying to run /run-fleet in a new thread", async () => {
    const gone: ReasonView = { code: "manager-gone", text: "The manager thread is archived or gone: run /run-fleet in a new thread to take the fleet over", fix: { kind: "none" } };
    await show(fleetsView({ fleets: [fleet("org/dash", { reasons: [gone] })] }));
    const mark = within(line("org/dash")).getByLabelText(gone.text);
    expect(mark.tagName).not.toBe("BUTTON");
    expect(drawnIcons(mark)).toEqual(["CircleX"]);
  });

  it("shows only the Fleet tab icon for a fleet with no problem and no warning, and that icon opens the tab", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })] }));
    expect(within(line("org/dash")).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(["org/dash", "Open the Fleet tab of org/dash"]);
    fireEvent.click(within(line("org/dash")).getByRole("button", { name: "Open the Fleet tab of org/dash" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_org/dash");
  });

  it("leaves late polling to the polling cell, with no verb", async () => {
    await show(fleetsView({ fleets: [fleet("org/late", { waiting: 1, warnings: [{ kind: "polling-late", lastPolledAt: ago(9 * MINUTE) }] })] }));
    expect(line("org/late").querySelector(".bg-warning")).not.toBeNull();
    expect(within(line("org/late")).getAllByRole("button")).toHaveLength(2);
  });
});

describe("two fleets one manager thread holds", () => {
  it("draw one line each, however the board reorders them", async () => {
    await show(fleetsView({ fleets: [fleet("org/gone", { managerThreadId: "thr_m", waiting: 2 }), fleet("other-org/z", { managerThreadId: "thr_m", waiting: 1 })] }));
    expect(boardRepos()).toEqual(["org/gone", "other-org/z"]);
    fake.api.fleets.mockResolvedValue(fleetsView({ fleets: [fleet("org/gone", { managerThreadId: "thr_m", waiting: 1 }), fleet("other-org/z", { managerThreadId: "thr_m", waiting: 3 })] }));
    sdk.emit(BOARD_CHANGED);
    await waitFor(() => expect(boardRepos()).toEqual(["other-org/z", "org/gone"]));
  });
});

describe("the board's order and quiet fleets (AC7)", () => {
  it("folds a quiet fleet until its line is clicked", async () => {
    await show(fleetsView({ fleets: [fleet("acme/web"), fleet("org/dash", { waiting: 1 })] }));
    expect(boardRepos()).toEqual(["org/dash"]);
    fireEvent.click(within(board()).getByRole("button", { name: "1 quiet fleet" }));
    expect(boardRepos()).toEqual(["org/dash", "acme/web"]);
  });

  it("lists a fleet with a missing manifest and every count at zero first", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 9 }), fleet("org/gone", { reasons: [missing] })] }));
    expect(boardRepos()).toEqual(["org/gone", "org/dash"]);
  });

  it("lists a quiet fleet that is the filter", async () => {
    await show(fleetsView({ fleets: [fleet("acme/web"), fleet("org/dash", { waiting: 1 })] }));
    fireEvent.click(within(board()).getByRole("button", { name: "1 quiet fleet" }));
    fireEvent.click(within(line("acme/web")).getByRole("button", { name: "acme/web" }));
    expect(boardRepos()).toContain("acme/web");
    expect(within(board()).queryByRole("button", { name: "1 quiet fleet" })).toBeNull();
  });
});

describe("filtering the queue to a fleet (AC8)", () => {
  const view = () =>
    fleetsView({
      fleets: [fleet("org/dash", { waiting: 2 }), fleet("org/wake", { waiting: 1 })],
      inbox: [inboxRow({ id: "1", fleet: "org/dash", since: ago(3 * MINUTE) }), inboxRow({ id: "2", fleet: "org/wake", since: ago(2 * MINUTE) }), inboxRow({ id: "3", fleet: "org/dash", since: ago(MINUTE) })],
    });

  it("filters to the fleet whose line is clicked, its tabs counting that fleet only, its fleet column hidden", async () => {
    await show(view());
    expect(within(queue()).getAllByText("org/wake").length).toBeGreaterThan(0);
    fireEvent.click(line("org/dash"));
    expect(queueRows()).toHaveLength(2);
    expect(within(queue()).getByRole("tab", { name: "All 2" })).toBeTruthy();
    expect(within(within(queue()).getByRole("tabpanel")).queryByText("org/dash")).toBeNull();
    expect(within(line("org/dash")).getByRole("button", { name: "org/dash" }).getAttribute("aria-pressed")).toBe("true");
    expect(line("org/dash").className).toContain("bg-accent");
  });

  it("shows a chip with the fleet's logo, its name and an ✕, which clears the filter", async () => {
    await show(view());
    fireEvent.click(within(line("org/dash")).getByRole("button", { name: "org/dash" }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Show every fleet, not only org/dash" }));
    expect(queueRows()).toHaveLength(3);
    expect(within(line("org/dash")).getByRole("button", { name: "org/dash" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clears the filter when the line is clicked again", async () => {
    await show(view());
    fireEvent.click(line("org/dash"));
    fireEvent.click(line("org/dash"));
    expect(queueRows()).toHaveLength(3);
  });

  it("keeps the filter when the operator comes back from the Fleet tab, which leaves the page", async () => {
    await show(view());
    fireEvent.click(line("org/dash"));
    fireEvent.click(within(line("org/dash")).getByRole("button", { name: "Open the Fleet tab of org/dash" }));
    cleanup();
    await show(view());
    expect(queueRows()).toHaveLength(2);
    expect(within(line("org/dash")).getByRole("button", { name: "org/dash" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves the filter as it is when the Fleet tab icon is clicked", async () => {
    await show(view());
    fireEvent.click(line("org/dash"));
    fireEvent.click(within(line("org/dash")).getByRole("button", { name: "Open the Fleet tab of org/dash" }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_org/dash");
    expect(queueRows()).toHaveLength(2);
  });
});

describe("the queue (AC9–AC13)", () => {
  it("filters by kind, and shows Unreadable only while there is an unreadable row", async () => {
    const inbox = [...[1, 2, 3, 4].map((n) => inboxRow({ id: `a${n}`, fleet: "org/dash" })), inboxRow({ id: "g", fleet: "org/dash", ref: "#9", waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: false } })];
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 5 })], inbox }));
    expect(within(queue()).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["All 5", "Answer 4", "Grant 1", "Build 0", "Other 0", "Sent 0"]);
    fireEvent.click(within(queue()).getByRole("tab", { name: "Grant 1" }));
    expect(queueRows()).toHaveLength(1);
    expect(queueRows()[0]!.textContent).toContain("#9");
  });

  it("draws a row's kind icon, title, short link, age with a clock, fleet and action, the age amber after 8 hours", async () => {
    await show(
      fleetsView({
        fleets: [fleet("org/dash", { waiting: 2 })],
        inbox: [
          inboxRow({ id: "old", fleet: "org/dash", ref: "#7", what: "Which cache to use", since: ago(11 * HOUR + 36 * MINUTE), link: { kind: "url", url: "https://github.test/org/dash/issues/7", text: "github.test/org/dash/issues/7" } }),
          inboxRow({ id: "new", fleet: "org/dash", since: ago(20_000) }),
        ],
      }),
    );
    const [old, fresh] = queueRows();
    expect(drawnIcons(old!).slice(0, 2)).toEqual(["MessageSquare", "Clock"]);
    expect(within(old!).getByText("#7 Which cache to use")).toBeTruthy();
    expect(within(old!).getByRole("link", { name: "#7 ↗" })).toBeTruthy();
    expect(within(old!).getByText("11h 36m").className).toContain("text-warning-text");
    expect(within(fresh!).getByText("20s").className).toContain("text-muted-foreground");
    expect(within(old!).getByText("org/dash")).toBeTruthy();
    expect(within(old!).getByRole("button", { name: "Answer… #7" }).className).toContain("text-timeline-accent");
  });

  it("draws an unreadable row as a red line with Review, which opens the Fleet tab", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })], unreadableInbox: [unreadableInboxRow({ fleet: "org/dash", managerThreadId: "thr_org/dash", line: 9 })] }));
    const row = queueRows()[0]!;
    expect(within(row).getByText('Unreadable Inbox row, line 9: the table has no "Waits for" column').className).toContain("text-destructive-text");
    fireEvent.click(within(row).getByRole("button", { name: /Review/ }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_org/dash");
    expect(within(queue()).getByRole("tab", { name: "Unreadable 1" })).toBeTruthy();
  });

  it("keeps each action state: sent with its age, done, watch only, and Re-grant beside Grant…", async () => {
    await show(
      fleetsView({
        fleets: [fleet("org/dash", { waiting: 4 })],
        inbox: [
          inboxRow({ id: "s", fleet: "org/dash", ref: "#1", offer: null, action: actionRecord({ sentAt: ago(4 * MINUTE) }) }),
          inboxRow({ id: "d", fleet: "org/dash", ref: "#2", waitsFor: "ready", offer: null, action: actionRecord({ kind: "build", state: "done", doneAt: ago(MINUTE) }) }),
          inboxRow({ id: "o", fleet: "org/dash", ref: "#3", waitsFor: "other", offer: null }),
          inboxRow({ id: "g", fleet: "org/dash", ref: "#4", waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: true } }),
        ],
      }),
    );
    const [sent, done, other, grant] = queueRows();
    expect(within(sent!).getByText("sent · 4m")).toBeTruthy();
    expect(within(done!).getByText("done")).toBeTruthy();
    expect(drawnIcons(done!)).toContain("Check");
    expect(within(other!).getByText("watch only")).toBeTruthy();
    expect(within(grant!).getByRole("button", { name: "Grant… #4" })).toBeTruthy();
    expect(within(grant!).getByRole("button", { name: "Re-grant #4" })).toBeTruthy();
  });

  it("opens a composer under the row naming the item and the manager, and keeps the draft when bb refuses it", async () => {
    let refuse: (value: { ok: false; reason: string }) => void = () => {};
    fake.api.sendAction.mockReturnValue(new Promise((resolve) => (refuse = resolve)));
    await show(fleetsView({ fleets: [fleet("org/wake", { waiting: 1 })], inbox: [inboxRow({ fleet: "org/wake", ref: "#7", what: "Which cache to use" })] }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Answer… #7" }));
    const row = queueRows()[0]!;
    expect(within(row).getByText("Your answer for #7 Which cache to use · goes to org/wake's manager")).toBeTruthy();
    expect(within(row).getByText("composing…")).toBeTruthy();
    expect(within(row).getByText("⌘↵ send · Esc cancel")).toBeTruthy();
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "Use Redis" } });
    fireEvent.click(within(row).getByRole("button", { name: "Send" }));
    expect(await within(queueRows()[0]!).findByText("sending…")).toBeTruthy();
    await act(async () => refuse({ ok: false, reason: "the manager thread is archived" }));
    const refused = queueRows()[0]!;
    expect(within(refused).getByRole("alert").textContent).toBe("Not sent: the manager thread is archived");
    expect((within(refused).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Use Redis");
    expect(within(refused).queryByText("⌘↵ send · Esc cancel")).toBeNull();
  });

  it("says not sent beside the title when bb refuses Build it, the reason on hover, and keeps the button", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: false, reason: "the manager thread is archived" });
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })], inbox: [inboxRow({ fleet: "org/dash", ref: "#8", waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } })] }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Build it #8" }));
    const mark = await within(queue()).findByLabelText("not sent: the manager thread is archived");
    expect(mark.textContent).toBe("not sent");
    expect(await hoverText(mark)).toBe("the manager thread is archived");
    expect(within(queue()).getByRole("button", { name: "Build it #8" })).toBeTruthy();
  });

  it("says beside the action when the last send could not be confirmed", async () => {
    fake.api.sendAction.mockRejectedValue(new Error("the connection dropped"));
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })], inbox: [inboxRow({ fleet: "org/dash", ref: "#9", waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } })] }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Build it #9" }));
    const note = await within(queue()).findByText("could not confirm whether the last send went through");
    expect(note.parentElement!.contains(within(queue()).getByRole("button", { name: "Build it #9" }))).toBe(true);
  });

  it("labels a link to the row's pull request by the pull request, not the row's Ref", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })], inbox: [inboxRow({ fleet: "org/dash", ref: "#7", waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: false }, link: { kind: "url", url: "https://github.test/org/dash/pull/12", text: "github.test/org/dash/pull/12" } })] }));
    expect(within(queue()).getByRole("link", { name: "#12 ↗" }).getAttribute("href")).toBe("https://github.test/org/dash/pull/12");
  });

  it("says not sent beside the title when bb refuses a Re-grant", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: false, reason: "the manager thread is archived" });
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })], inbox: [inboxRow({ fleet: "org/dash", ref: "#4", waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: true } })] }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Re-grant #4" }));
    expect(await within(queue()).findByLabelText("not sent: the manager thread is archived")).toBeTruthy();
    expect(within(queue()).getByRole("button", { name: "Re-grant #4" })).toBeTruthy();
  });

  it("lists under Sent what was seen done in the last hour", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash")], recentActions: [actionRecord({ fleet: "org/dash", kind: "answer", ref: "#5", what: "Which queue", state: "done", doneAt: ago(40 * MINUTE) })] }));
    fireEvent.click(within(queue()).getByRole("tab", { name: "Sent 1" }));
    const sent = queueRows()[0]!;
    expect(sent.textContent).toBe("You answered #5 Which queue40m agoorg/dashdone");
    expect(drawnIcons(sent)).toEqual(["MessageSquare", "GithubLogo", "Check"]);
  });
});

describe("on a phone (AC15)", () => {
  beforeEach(() => setCompactViewport(true));

  it("condenses the board to three fleets, the rest folded", async () => {
    await show(fleetsView({ fleets: ["a", "b", "c", "d", "e"].map((name, n) => fleet(`org/${name}`, { waiting: 5 - n })) }));
    expect(boardRepos()).toEqual(["org/a", "org/b", "org/c"]);
    fireEvent.click(within(board()).getByRole("button", { name: "2 more fleets" }));
    expect(boardRepos()).toHaveLength(5);
  });

  it("filters the queue when a fleet's line is tapped", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 }), fleet("org/wake", { waiting: 1 })], inbox: [inboxRow({ id: "1", fleet: "org/dash" }), inboxRow({ id: "2", fleet: "org/wake" })] }));
    fireEvent.click(line("org/dash"));
    expect(queueRows()).toHaveLength(1);
  });

  it("makes a fleet's fix a touch-sized button named by its sentence, doing what the verb does", async () => {
    await show(fleetsView({ fleets: [fleet("other-org/x", { reasons: [noForge] })] }));
    const fix = within(line("other-org/x")).getByRole("button", { name: "no GitHub account can read other-org" });
    expect(fix.className).toContain("size-11");
    fireEvent.click(fix);
    expect(currentConnect()?.request).toEqual({ target: { fleet: "other-org/x", role: "forge" } });
  });

  it("shows a fleet's non-zero counts on the right", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 6, landed: 1 })] }));
    expect(within(line("org/dash")).getByLabelText("6 waiting on you")).toBeTruthy();
    expect(within(line("org/dash")).queryByLabelText(/blocked/)).toBeNull();
  });

  it("makes the kind tabs pills", async () => {
    await show(fleetsView({ fleets: [fleet("org/dash", { waiting: 1 })], inbox: [inboxRow({ fleet: "org/dash", ref: "#7" })] }));
    expect(within(queue()).getByRole("tab", { name: "All 1" }).className).toContain("rounded-full");
  });
});

describe("a queue row on a phone (#273)", () => {
  beforeEach(() => setCompactViewport(true));

  const gh = (path: string, over: Partial<FleetCardView> = {}) => fleet(`github.example/${path}`, { waiting: 1, ...over });
  const threadLink = (threadId: string, message: number) => ({ kind: "message" as const, message: { threadId, message, at: ago(MINUTE) } });
  /** A row's three parts: the title, the details and the action. */
  const parts = (row: HTMLElement) => [...row.children].slice(0, 3) as HTMLElement[];

  it("stacks the title, the details and the action, each on a line of its own (AC1)", async () => {
    await show(
      fleetsView({
        fleets: [gh("org/orphan"), gh("org/dash")],
        inbox: [inboxRow({ fleet: "github.example/org/orphan", ref: "—", what: "Merge the cache layer rewrite", waitsFor: "grant", since: ago(9 * HOUR + 4 * MINUTE), link: threadLink("thr_den6jrijzx", 2), offer: { kind: "grant", label: "Grant…", regrant: true } })],
      }),
    );
    const [title, details, action] = parts(queueRows()[0]!);
    expect(title!.textContent).toBe("Merge the cache layer rewrite");
    expect(details!.textContent).toBe("orphangithub.example/org/orphan↗9h 4m");
    const buttons = within(action!).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Grant…", "Re-grant"]);
    // Side by side, each taking half the line.
    for (const button of buttons) expect(button.className).toContain("flex-1");
  });

  it("lets the title wrap onto a second line, cut only past it, with nothing beside it (AC2)", async () => {
    await show(fleetsView({ fleets: [gh("org/wake")], inbox: [inboxRow({ fleet: "github.example/org/wake", ref: "—", what: "Decide whether the very long retry budget should also apply to webhook deliveries" })] }));
    const [title] = parts(queueRows()[0]!);
    const text = within(title!).getByText("Decide whether the very long retry budget should also apply to webhook deliveries");
    expect(text.className).toContain("line-clamp-2");
    expect(text.className).not.toContain("truncate");
    expect(within(title!).queryByRole("button")).toBeNull();
  });

  it("names each fleet by its short name, its full name its accessible name (AC3, AC4)", async () => {
    await show(
      fleetsView({
        fleets: [gh("org/dash"), gh("other/dash"), gh("org/wake")],
        inbox: [
          inboxRow({ id: "1", fleet: "github.example/org/dash" }),
          inboxRow({ id: "2", fleet: "github.example/other/dash" }),
          inboxRow({ id: "3", fleet: "github.example/org/wake", ref: "#7", since: ago(11 * HOUR + 40 * MINUTE), link: { kind: "url", url: "https://github.example/org/wake/issues/7", text: "github.example/org/wake/issues/7" } }),
        ],
      }),
    );
    const shown = queueRows().map((row) => parts(row)[1]!.querySelector("span[aria-hidden].truncate")?.textContent);
    expect(shown).toEqual(["org/dash", "other/dash", "wake"]);
    const wake = parts(queueRows()[2]!)[1]!;
    expect(within(wake).getByText("github.example/org/wake").className).toContain("sr-only");
    expect(wake.textContent).toBe("wakegithub.example/org/wake#7 ↗11h 40m");
  });

  it("lets a short name too long to share the line take it whole, the link and the age kept together (AC4)", async () => {
    const long = "github.example/platform-engineering/internal-developer-portal-observability";
    await show(fleetsView({ fleets: [fleet(long, { waiting: 1 })], inbox: [inboxRow({ fleet: long, ref: "#9" })] }));
    const details = parts(queueRows()[0]!)[1]!;
    const [name, rest] = [...details.children] as HTMLElement[];
    // The name never shrinks to share the line; the link and the age wrap under it as one.
    expect(name!.className).toContain("shrink-0");
    expect(name!.className).toContain("max-w-full");
    expect(details.className).toContain("flex-wrap");
    expect(rest!.textContent).toBe("↗5m");
    expect(rest!.querySelector(".whitespace-nowrap")?.textContent).toBe("5m");
  });

  it("leaves the fleet out of the details while the queue is filtered to it (AC4)", async () => {
    await show(fleetsView({ fleets: [gh("org/dash"), gh("org/wake")], inbox: [inboxRow({ id: "1", fleet: "github.example/org/dash", ref: "#7", link: { kind: "url", url: "https://github.example/org/dash/pull/7", text: "github.example/org/dash/pull/7" } }), inboxRow({ id: "2", fleet: "github.example/org/wake" })] }));
    fireEvent.click(line("github.example/org/dash"));
    expect(parts(queueRows()[0]!)[1]!.textContent).toBe("#7 ↗5m");
  });

  it("shows a link with no short form as the arrow alone, its text the accessible name, with a 44 px tap area (AC5)", async () => {
    await show(fleetsView({ fleets: [gh("org/orphan")], inbox: [inboxRow({ fleet: "github.example/org/orphan", link: threadLink("thr_den6jrijzx", 2) })] }));
    const link = within(queue()).getByRole("button", { name: "thread thr_den6jrijzx, message 2" });
    expect(link.textContent).toBe("↗");
    expect(link.className).toContain("before:h-11");
    expect(link.className).toContain("before:w-[max(100%,2.75rem)]");
    fireEvent.click(link);
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_den6jrijzx");
  });

  it("shows a link's short form where its URL has one (AC5)", async () => {
    await show(fleetsView({ fleets: [fleet("gitlab.example/group/proj", { waiting: 1 })], inbox: [inboxRow({ fleet: "gitlab.example/group/proj", link: { kind: "url", url: "https://gitlab.example/group/proj/-/merge_requests/3", text: "gitlab.example/group/proj/-/merge_requests/3" } })] }));
    expect(within(queue()).getByRole("link", { name: "!3 ↗" }).className).toContain("before:h-11");
  });

  it("keeps the action line at the buttons' height in every state but watch only (AC6)", async () => {
    await show(
      fleetsView({
        fleets: [gh("org/dash")],
        inbox: [
          inboxRow({ id: "o", fleet: "github.example/org/dash", ref: "#1" }),
          inboxRow({ id: "s", fleet: "github.example/org/dash", ref: "#2", offer: null, action: actionRecord({ sentAt: ago(4 * MINUTE) }) }),
          inboxRow({ id: "d", fleet: "github.example/org/dash", ref: "#3", waitsFor: "ready", offer: null, action: actionRecord({ kind: "build", state: "done", doneAt: ago(MINUTE) }) }),
          inboxRow({ id: "w", fleet: "github.example/org/dash", ref: "#4", waitsFor: "other", offer: null }),
        ],
      }),
    );
    const actions = queueRows().map((row) => parts(row)[2]!);
    expect(within(actions[0]!).getByRole("button", { name: "Answer… #1" }).className).toContain("h-11");
    expect(actions[1]!.textContent).toBe("sent · 4m");
    expect(actions[1]!.className).toContain("h-11");
    expect(actions[2]!.textContent).toBe("done");
    expect(actions[2]!.className).toContain("h-11");
    expect(actions[3]!.textContent).toBe("watch only");
    expect(actions[3]!.className).not.toContain("h-11");
  });

  it("says composing… in the action line with the composer under the row (AC6)", async () => {
    await show(fleetsView({ fleets: [gh("org/dash")], inbox: [inboxRow({ fleet: "github.example/org/dash", ref: "#1" })] }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Answer… #1" }));
    const row = queueRows()[0]!;
    expect(parts(row)[2]!.textContent).toBe("composing…");
    expect(parts(row)[2]!.className).toContain("h-11");
    expect(within(row).getByRole("textbox")).toBeTruthy();
  });

  it("spells out a refused Build it under the button, which stays (AC7)", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: false, reason: "HTTP 409: Thread is archived" });
    await show(fleetsView({ fleets: [gh("org/dash")], inbox: [inboxRow({ fleet: "github.example/org/dash", ref: "#9", waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } })] }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Build it #9" }));
    await within(queue()).findByText("Not sent: HTTP 409: Thread is archived");
    const action = parts(queueRows()[0]!)[2]!;
    expect(within(action).getByText("Not sent: HTTP 409: Thread is archived").className).toContain("text-destructive-text");
    expect(within(action).getByRole("button", { name: "Build it #9" })).toBeTruthy();
  });

  it("spells out a send that could not be confirmed under the button (AC7)", async () => {
    fake.api.sendAction.mockRejectedValue(new Error("the connection dropped"));
    await show(fleetsView({ fleets: [gh("org/dash")], inbox: [inboxRow({ fleet: "github.example/org/dash", ref: "#9", waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } })] }));
    fireEvent.click(within(queue()).getByRole("button", { name: "Build it #9" }));
    await within(queue()).findByText("could not confirm whether the last send went through");
    const action = parts(queueRows()[0]!)[2]!;
    expect(within(action).getByText("could not confirm whether the last send went through")).toBeTruthy();
    expect(within(action).getByRole("button", { name: "Build it #9" })).toBeTruthy();
  });

  it("names a Sent line's fleet by its short name (AC8)", async () => {
    await show(fleetsView({ fleets: [gh("org/dash"), gh("org/wake")], recentActions: [actionRecord({ fleet: "github.example/org/dash", kind: "answer", ref: "#5", what: "Which queue", state: "done", doneAt: ago(40 * MINUTE) })] }));
    fireEvent.click(within(queue()).getByRole("tab", { name: "Sent 1" }));
    expect(queueRows()[0]!.querySelector("span[aria-hidden].truncate")?.textContent).toBe("dash");
  });

  it("names each board line's fleet by its short name, its toggle by the full name (AC9)", async () => {
    await show(fleetsView({ fleets: [gh("org/dash", { reasons: [missing] }), gh("org/orphan", { reasons: [missing] }), gh("org/wake", { reasons: [missing] })] }));
    for (const name of ["dash", "orphan", "wake"]) {
      const toggle = within(line(`github.example/org/${name}`)).getByRole("button", { name: `github.example/org/${name}` });
      expect(toggle.textContent).toBe(name);
    }
  });

  it("names the filter chip's fleet by its short name, its ✕ touch-sized and naming the full fleet (AC12)", async () => {
    await show(fleetsView({ fleets: [gh("org/dash"), gh("org/wake")] }));
    fireEvent.click(line("github.example/org/dash"));
    const clear = within(queue()).getByRole("button", { name: "Show every fleet, not only github.example/org/dash" });
    expect(clear.className).toContain("size-11");
    expect(clear.parentElement!.textContent).toBe("dash");
  });
});

describe("a queue row at 768 px and wider (AC11)", () => {
  it("keeps the full fleet name and the link's own text", async () => {
    await show(fleetsView({ fleets: [fleet("github.example/org/dash", { waiting: 1 }), fleet("github.example/org/wake")], inbox: [inboxRow({ fleet: "github.example/org/dash", link: { kind: "message", message: { threadId: "thr_den6jrijzx", message: 2, at: ago(MINUTE) } } })] }));
    const row = queueRows()[0]!;
    expect(within(row).getByText("github.example/org/dash")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "thread thr_den6jrijzx, message 2 ↗" })).toBeTruthy();
    expect(within(line("github.example/org/dash")).getByRole("button", { name: "github.example/org/dash" })).toBeTruthy();
  });
});
