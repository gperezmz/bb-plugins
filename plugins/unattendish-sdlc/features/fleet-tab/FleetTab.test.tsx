// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetDetailView, ProblemView, WarningView } from "@/src/fleet/application/views";
import { closeConnect, currentConnect } from "@/shared/connect/requests";
import { clearReviewRequests, requestReview } from "@/shared/review-request";
import { fake, resetFakeApi } from "@/testing/api";
import { actionRecord, ago, fleetCard, fleetCredential, fleetDetail, HOUR, inboxRow, landedRow, ledgerChange, ledgerView, managerFleet, MINUTE, unreadableInboxRow } from "@/testing/fixtures";
import { drawnIcons, expectIconsResolve } from "@/testing/icons";
import { expectGrantLook } from "@/testing/look";
import { sdk } from "@/testing/sdk";
import { setCompactViewport } from "@/testing/viewport";
import { FleetTab } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

const scrolled: Element[] = [];

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  setCompactViewport(false);
  fake.api.threadFleet.mockResolvedValue(managerFleet());
  scrolled.length = 0;
  // jsdom lays nothing out, so it has no scrollIntoView; record what Review scrolls to.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  cleanup();
  closeConnect();
  clearReviewRequests();
});

type OkManifest = Extract<FleetDetailView["manifest"], { status: "ok" }>;

const okManifest: OkManifest = {
  status: "ok",
  inbox: [inboxRow()],
  unreadableInbox: [unreadableInboxRow({ line: 9 })],
  inFlight: [
    { ref: "#163", work: "refuse long titles", stage: "at the bar", since: ago(25 * MINUTE), builderThreadId: "thr_b1", link: { kind: "url", url: "https://github.test/acme/web/pull/166", text: "github.test/acme/web/pull/166" } },
    { ref: "—", work: "Brainstorm on Backlog", stage: "brainstorming", since: ago(8 * MINUTE), builderThreadId: null, link: { kind: "url", url: "https://github.test/x", text: "notes" } },
  ],
  blocked: [{ ref: "#171", blockedOn: ["#170", "#172"], link: { kind: "url", url: "https://github.test/acme/web/issues/171", text: "#171" } }],
  landed: [landedRow({ ref: "#164", spec: "read one ticket" })],
  unreadable: [
    { section: "Inbox", line: 9, reason: 'the table has no "Waits for" column' },
    { section: "Blocked", line: 22, reason: 'the table has no "Blocked on" column' },
  ],
  written: [
    { heading: "Backlog", markdown: "- An id beyond the integer range answers 503.\n- Second item" },
    { heading: "Set aside", markdown: "" },
    { heading: "Standing orders", markdown: "**Merge grant:** merge what clears the bar." },
  ],
};

const unreadableInbox: ProblemView = { code: "unreadable-rows", text: "1 manifest row cannot be read: Inbox", fix: { kind: "fleet-tab" } };

const detailWith = (over: Partial<FleetDetailView> = {}): FleetDetailView =>
  fleetDetail({
    manifest: okManifest,
    watched: [
      { ref: "#163", url: "https://github.test/acme/web/issues/163", why: ["named in In flight"] },
      { ref: "#170", url: "https://github.test/acme/web/issues/170", why: ["blocked on #170"] },
      { ref: "#171", url: null, why: ["named in Inbox", "blocked on #170"] },
    ],
    credentials: [
      fleetCredential({ label: "GitHub · yuser for acme", expiresAt: "2026-10-18T12:00:00Z" }),
      fleetCredential({ label: "GitHub · buser for every owner", account: { id: "acc_buser", label: "GitHub · buser" }, kind: "gh", auth: "gh", canWrite: true, sharesAgentRateLimit: true }),
    ],
    requestsThisHour: 188,
    ...over,
  });

const showDetail = async (over: Partial<FleetDetailView> = {}) => {
  fake.api.fleetDetail.mockResolvedValue({ ok: true, detail: detailWith(over) });
  await act(async () => {
    render(<FleetTab threadId="thr_acme" />);
  });
  return screen.findByRole("banner", { name: "Fleet acme/web" });
};

const tab = (name: RegExp | string) => screen.getByRole("tab", { name });
/** A tab's panel, shown or not: a hidden panel has no accessible name to find it by. */
const panel = (name: string) => document.getElementById(`fleet-tab-panel-${name.toLowerCase()}`)!;
const section = (name: RegExp) => screen.getByRole("heading", { name }).closest("section")!;

describe("a thread with no registration (#258 AC13)", () => {
  it("says it runs no fleet", async () => {
    fake.api.threadFleet.mockResolvedValue({ kind: "none", holder: null });
    render(<FleetTab threadId="thr_x" />);
    expect(await screen.findByText("This thread runs no fleet.")).toBeTruthy();
    expect(fake.api.fleetDetail).not.toHaveBeenCalled();
  });

  it("names the manager holding the thread's repository, linking to it", async () => {
    fake.api.threadFleet.mockResolvedValue({ kind: "none", holder: { repo: "acme/web", managerThreadId: "thr_acme" } });
    render(<FleetTab threadId="thr_x" />);
    expect(await screen.findByText(/acme\/web is run by/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /its manager thread/ }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_acme");
  });

  it("fails in words when the fleet cannot be loaded", async () => {
    fake.api.fleetDetail.mockResolvedValue({ ok: false, reason: "no fleet is registered for acme/web" });
    render(<FleetTab threadId="thr_acme" />);
    expect((await screen.findByRole("alert")).textContent).toContain("no fleet is registered for acme/web");
  });
});

describe("the header (#258 AC1)", () => {
  it("shows org/dash's counts, its spend and a red strip with Review for an unreadable Inbox row", async () => {
    fake.api.threadFleet.mockResolvedValue(managerFleet(fleetCard({ repo: "org/dash" })));
    fake.api.fleetDetail.mockResolvedValue({
      ok: true,
      detail: detailWith({ card: fleetCard({ repo: "org/dash", blocked: 1, inFlight: 2, waiting: 6, landed: 1, cost: { amount: 4.12, currency: "$", period: "since this manager started", sharedWith: [] }, problems: [unreadableInbox] }) }),
    });
    render(<FleetTab threadId="thr_acme" />);
    const header = await screen.findByRole("banner", { name: "Fleet org/dash" });
    for (const label of ["1 blocked", "2 in flight", "6 waiting on you", "1 landed in the last 7 days"]) expect(within(header).getByLabelText(label)).toBeTruthy();
    expect(within(header).getByText("$4.12")).toBeTruthy();
    const strip = within(header).getByText("1 manifest row cannot be read: Inbox").closest("li")!;
    expect(strip.className).toContain("bg-destructive/10");
    expect(strip.className).toContain("text-destructive-text");
    expect(within(strip).getByRole("button", { name: /^Review/ }).textContent).toBe("Review");
  });

  it("shows the forge's logo, the fleet's name, and a tracker of its own as its name and key", async () => {
    const header = await showDetail();
    expect(within(header).getByRole("img", { name: "GitHub" })).toBeTruthy();
    expect(within(header).getByText("acme/web")).toBeTruthy();
    expect(within(header).getByText("Linear")).toBeTruthy();
    expect(within(header).getByText("ENG")).toBeTruthy();
  });

  it("leaves a zero count out, and the spend where there is none", async () => {
    const header = await showDetail({ card: fleetCard({ inFlight: 2 }) });
    expect(within(header).getByLabelText("2 in flight")).toBeTruthy();
    expect(within(header).queryByLabelText(/blocked|waiting on you|landed/)).toBeNull();
    expect(within(header).queryByText(/\$/)).toBeNull();
  });

  it("shows the manager's state: idle with its duration, working with none, and no manager", async () => {
    let header = await showDetail({ card: fleetCard({ manager: { state: "idle", since: ago(12 * MINUTE) } }) });
    expect(within(header).getByRole("img", { name: "Manager idle for 12m" })).toBeTruthy();
    expect(within(header).getByText("12m")).toBeTruthy();
    cleanup();
    header = await showDetail({ card: fleetCard({ manager: { state: "working", since: ago(HOUR) } }) });
    expect(within(header).getByRole("img", { name: "Manager working" }).className).toContain("motion-safe:animate-spin");
    expect(within(header).queryByText("1h")).toBeNull();
    cleanup();
    header = await showDetail({ card: fleetCard({ manager: { state: "none", since: null } }) });
    expect(within(header).getByRole("img", { name: /No manager/ }).parentElement!.className).toContain("text-destructive-text");
  });

  it("gives each problem and warning its verb: Connect…, Renew…, and none for a gone manager or late polling", async () => {
    const expiring: WarningView = { kind: "expires", label: "GitHub · yuser for acme", credentialId: "cred_1", accountId: "acc_1", role: "forge", expiresAt: "2026-10-15T12:00:00Z", daysLeft: 3 };
    const gone: ProblemView = { code: "manager-gone", text: "The manager thread is archived or gone: run /run-fleet in a new thread to take the fleet over", fix: { kind: "none" } };
    const header = await showDetail({
      card: fleetCard({
        problems: [{ code: "no-credential", text: "no Linear account reads team ENG", fix: { kind: "connect", role: "tracker" } }, gone],
        warnings: [expiring, { kind: "polling-late", lastPolledAt: ago(9 * MINUTE) }],
      }),
    });
    const strips = within(header).getAllByRole("listitem");
    expect(strips.map((strip) => strip.querySelector("button")?.textContent ?? null)).toEqual(["Connect…", null, "Renew…", null]);
    expect(strips[1]!.textContent).toContain("run /run-fleet in a new thread");
    expect(strips[2]!.className).toContain("text-warning-text");
    expect(strips[3]!.textContent).toContain("polling is late");
    fireEvent.click(within(strips[0]!).getByRole("button"));
    expect(currentConnect()?.request).toMatchObject({ target: { fleet: "acme/web", role: "tracker" } });
    fireEvent.click(within(strips[2]!).getByRole("button"));
    expect(currentConnect()?.request).toMatchObject({ target: { fleet: "acme/web", role: "forge" }, account: "acc_1", replaces: "cred_1" });
  });

  it("shows an expired token as a red strip with Renew…, saying it expired 1 day ago (#261 AC4)", async () => {
    const expired: ProblemView = { code: "token-expired", text: "GitHub · yuser for acme: token expired", fix: { kind: "renew", role: "forge", accountId: "acc_1", credentialId: "cred_1" }, label: "GitHub · yuser for acme", expiresAt: ago(24 * HOUR) };
    const header = await showDetail({ card: fleetCard({ problems: [expired] }) });
    const [strip] = within(header).getAllByRole("listitem");
    expect(strip!.textContent).toContain("GitHub · yuser for acme: token expired 1 day ago");
    expect(strip!.className).toContain("text-destructive-text");
    fireEvent.click(within(strip!).getByRole("button", { name: /^Renew…/ }));
    expect(currentConnect()?.request).toMatchObject({ target: { fleet: "acme/web", role: "forge" }, account: "acc_1", replaces: "cred_1" });
  });

  it("shows the last action seen done in the last hour, and leaves the line out with none", async () => {
    let header = await showDetail({ lastAction: actionRecord({ kind: "answer", ref: "#5", what: "Which queue", state: "done", doneAt: ago(40 * MINUTE) }) });
    expect(within(header).getByText("You answered #5 Which queue · done 40m ago")).toBeTruthy();
    cleanup();
    header = await showDetail({ lastAction: null });
    expect(within(header).queryByText(/You /)).toBeNull();
  });
});

describe("the tabs (#258 AC2)", () => {
  it("opens on Work, with four tabs under the header, each with its count", async () => {
    await showDetail({ card: fleetCard({ waiting: 2 }) });
    expect(screen.getAllByRole("tab").map((entry) => entry.textContent)).toEqual(["Work2", "Notes3", "Watching3", "Ledger"]);
    expect(tab(/^Work/).getAttribute("aria-selected")).toBe("true");
    expect(within(tab(/^Work/)).getByText("2").className).toContain("text-warning-text");
    expect(screen.getByRole("tablist").className).toContain("sticky");
    expect(panel("Work").hidden).toBe(false);
    expect(panel("Notes").hidden).toBe(true);
  });

  it("shows no Ledger number given no read failed in the last 24 hours", async () => {
    await showDetail({ failedReads: 0 });
    expect(tab(/^Ledger/).textContent).toBe("Ledger");
  });

  it("shows a red 1 on Ledger given one read failed 2 hours ago", async () => {
    await showDetail({ failedReads: 1 });
    const ledger = tab("Ledger, 1 read failed in the last 24 hours");
    expect(within(ledger).getByText("1").className).toContain("text-destructive-text");
  });

  it("moves between tabs with the arrow keys", async () => {
    await showDetail();
    fireEvent.keyDown(tab(/^Work/), { key: "ArrowRight" });
    expect(tab(/^Notes/).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(/^Notes/), { key: "ArrowLeft" });
    fireEvent.keyDown(tab(/^Work/), { key: "ArrowLeft" });
    expect(tab(/^Ledger/).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Work (#258 AC3)", () => {
  it("holds four folding sections, Landed folded, each with its icon, name and count, and folds or unfolds on a click", async () => {
    await showDetail();
    const headings = within(panel("Work")).getAllByRole("button", { expanded: true }).concat(within(panel("Work")).getAllByRole("button", { expanded: false }));
    expect(headings.map((button) => button.textContent)).toEqual(["Waits on you2", "In flight2", "Blocked2", "Landed1"]);
    const landed = within(panel("Work")).getByRole("button", { name: /^Landed/ });
    expect(landed.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("#164 read one ticket")).toBeNull();
    fireEvent.click(landed);
    expect(screen.getByText("#164 read one ticket")).toBeTruthy();
    fireEvent.click(within(panel("Work")).getByRole("button", { name: /^In flight/ }));
    expect(screen.queryByText("#163 refuse long titles")).toBeNull();
  });

  it("reads the missing manifest's sentence given the manifest is missing, not Nothing in flight", async () => {
    await showDetail({ manifest: { status: "missing" } });
    expect(within(panel("Work")).getByText("No manifest was found at the path the fleet registered.")).toBeTruthy();
    expect(screen.queryByText("Nothing in flight")).toBeNull();
    expect(screen.queryByRole("button", { name: /^In flight/ })).toBeNull();
  });

  it("says an unreadable manifest is unreadable and why", async () => {
    await showDetail({ manifest: { status: "unreadable", reason: "the first line is not a Fleet heading" } });
    expect(within(panel("Work")).getByText("The manifest cannot be read: the first line is not a Fleet heading")).toBeTruthy();
  });

  it("opens Work, unfolds In flight and scrolls to the row given an In flight row cannot be read and Review is pressed", async () => {
    const manifest: OkManifest = { ...okManifest, unreadableInbox: [], unreadable: [{ section: "In flight", line: 14, reason: 'the table has no "Stage" column' }] };
    const header = await showDetail({ manifest, card: fleetCard({ problems: [{ code: "unreadable-rows", text: "1 manifest row cannot be read: In flight", fix: { kind: "fleet-tab" } }] }) });
    fireEvent.click(within(panel("Work")).getByRole("button", { name: /^In flight/ }));
    fireEvent.click(tab(/^Notes/));
    fireEvent.click(within(header).getByRole("button", { name: /^Review/ }));
    expect(tab(/^Work/).getAttribute("aria-selected")).toBe("true");
    expect(within(panel("Work")).getByRole("button", { name: /^In flight/ }).getAttribute("aria-expanded")).toBe("true");
    const row = screen.getByText('Unreadable row, line 14: the table has no "Stage" column').closest("li")!;
    await waitFor(() => expect(scrolled).toContain(row));
  });
});

describe("Review from the Fleet chip's card (#258 AC1, AC12)", () => {
  const landedUnreadable: OkManifest = { ...okManifest, unreadableInbox: [], unreadable: [{ section: "Landed", line: 30, reason: 'the table has no "Merged" column' }] };
  const landedRow = () => screen.getByText('Unreadable row, line 30: the table has no "Merged" column').closest("li")!;

  it("opens Work at the row when the tab opens on the request, unfolding Landed", async () => {
    requestReview("thr_acme", "acme/web");
    await showDetail({ manifest: landedUnreadable });
    await waitFor(() => expect(scrolled).toContain(landedRow()));
    expect(within(panel("Work")).getByRole("button", { name: /^Landed/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("switches an open tab back to Work at the row", async () => {
    await showDetail({ manifest: landedUnreadable });
    fake.api.ledger.mockResolvedValue({ ok: true, ledger: ledgerView() });
    fireEvent.click(tab(/^Ledger/));
    act(() => requestReview("thr_acme", "acme/web"));
    await waitFor(() => expect(tab(/^Work/).getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(scrolled).toContain(landedRow()));
  });
});

describe("Waits on you (#258 AC4)", () => {
  it("shows a row's kind icon and title, then its short link and its age, with its action at the right", async () => {
    await showDetail({ manifest: { ...okManifest, inbox: [inboxRow({ ref: "#7", what: "Which cache", since: ago(9 * HOUR), link: { kind: "url", url: "https://github.test/acme/web/issues/7", text: "github.test/acme/web/issues/7" } })] } });
    const waits = section(/^Waits on you/);
    const row = within(waits).getByText("#7 Which cache").closest("li")!;
    expect(drawnIcons(row)).toContain("MessageSquare");
    expect(within(row).getByRole("link", { name: "#7 ↗" }).getAttribute("href")).toBe("https://github.test/acme/web/issues/7");
    expect(within(row).getByText("9h").className).toContain("text-warning-text");
    expect(within(row).getByRole("button", { name: "Answer… #7" }).className).toContain("border-timeline-accent");
  });

  it("offers Grant… with Re-grant, Build it, and watch only, as the Fleets page does", async () => {
    await showDetail({
      manifest: {
        ...okManifest,
        unreadableInbox: [],
        inbox: [
          inboxRow({ id: "g", ref: "#4", waitsFor: "grant", offer: { kind: "grant", label: "Grant…", regrant: true } }),
          inboxRow({ id: "b", ref: "#8", waitsFor: "ready", offer: { kind: "build", label: "Build it", regrant: false } }),
          inboxRow({ id: "o", ref: "#9", waitsFor: "other", offer: null }),
        ],
      },
    });
    const waits = section(/^Waits on you/);
    expect(within(waits).getByRole("button", { name: "Grant… #4" }).className).toContain("text-pr-merged");
    const regrant = within(waits).getByRole("button", { name: "Re-grant #4" });
    expectGrantLook(regrant);
    expect(drawnIcons(regrant)).toEqual(["unattendish-sdlc/redo"]);
    expect(within(waits).getByRole("button", { name: "Build it #8" }).className).toContain("text-success");
    expect(within(waits).getByText("watch only")).toBeTruthy();
  });

  it("draws the buttons 28 px tall, with a 44 px tap area only on a phone", async () => {
    const detail = {
      manifest: { ...okManifest, unreadableInbox: [], inbox: [inboxRow({ id: "b", ref: "#8", waitsFor: "ready" as const, offer: { kind: "build" as const, label: "Build it", regrant: false } })] },
    };
    await showDetail(detail);
    const build = () => within(section(/^Waits on you/)).getByRole("button", { name: "Build it #8" });
    expect(build().className).toContain("h-7");
    expect(build().className).not.toContain("before:h-11");
    cleanup();
    setCompactViewport(true);
    await showDetail(detail);
    expect(build().className).toContain("h-7");
    expect(build().className).toContain("before:h-11");
  });

  it("shows sent and done states", async () => {
    await showDetail({
      manifest: {
        ...okManifest,
        unreadableInbox: [],
        inbox: [inboxRow({ id: "s", ref: "#1", offer: null, action: actionRecord({ sentAt: ago(HOUR) }) }), inboxRow({ id: "d", ref: "#2", offer: null, action: actionRecord({ id: "act_2", state: "done", doneAt: ago(MINUTE) }) })],
      },
    });
    const waits = section(/^Waits on you/);
    expect(within(waits).getByText("sent · 1h")).toBeTruthy();
    expect(drawnIcons(within(waits).getByText("done").parentElement!)).toEqual(["Check"]);
  });

  it("holds a state at the buttons' height, 44 px on a phone", async () => {
    const detail = { manifest: { ...okManifest, unreadableInbox: [], inbox: [inboxRow({ id: "s", ref: "#1", offer: null, action: actionRecord({ sentAt: ago(HOUR) }) })] } };
    await showDetail(detail);
    expect(within(section(/^Waits on you/)).getByText("sent · 1h").className).toContain("h-7");
    cleanup();
    setCompactViewport(true);
    await showDetail(detail);
    expect(within(section(/^Waits on you/)).getByText("sent · 1h").className).toContain("h-11");
  });

  it("opens the composer under its row, and says Not sent in its footer when bb refuses the message", async () => {
    fake.api.sendAction.mockResolvedValue({ ok: false, reason: "the manager thread is archived" });
    await showDetail({ manifest: { ...okManifest, unreadableInbox: [], inbox: [inboxRow({ ref: "#7", what: "Which cache" })] } });
    const waits = section(/^Waits on you/);
    fireEvent.click(within(waits).getByRole("button", { name: "Answer… #7" }));
    fireEvent.change(within(waits).getByRole("textbox"), { target: { value: "Use Redis" } });
    fireEvent.click(within(waits).getByRole("button", { name: "Send" }));
    expect((await within(waits).findByRole("alert")).textContent).toBe("Not sent: the manager thread is archived");
    expect(fake.api.sendAction).toHaveBeenCalledWith({ fleet: "acme/web", rowId: "row_1", kind: "answer", text: "Use Redis" });
  });

  it("keeps a draft through folding the section and unfolding it", async () => {
    await showDetail({ manifest: { ...okManifest, unreadableInbox: [], inbox: [inboxRow({ ref: "#7", what: "Which cache" })] } });
    fireEvent.click(within(section(/^Waits on you/)).getByRole("button", { name: "Answer… #7" }));
    fireEvent.change(within(section(/^Waits on you/)).getByRole("textbox"), { target: { value: "Use Redis" } });
    const heading = within(panel("Work")).getByRole("button", { name: /^Waits on you/ });
    fireEvent.click(heading);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(heading);
    expect((within(section(/^Waits on you/)).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Use Redis");
  });

  it("shows an unreadable row as a red line", async () => {
    await showDetail();
    const line = within(section(/^Waits on you/)).getByText('Unreadable row, line 9: the table has no "Waits for" column');
    expect(line.className).toContain("text-destructive-text");
  });

  it("says when nothing waits", async () => {
    await showDetail({ manifest: { ...okManifest, inbox: [], unreadableInbox: [] } });
    expect(within(section(/^Waits on you/)).getByText("Nothing waits on you")).toBeTruthy();
  });
});

describe("In flight (#258 AC5)", () => {
  it("shows each row's stage icon in blue, title, short link, stage and duration, and builder", async () => {
    await showDetail();
    const inFlight = section(/^In flight/);
    const row = within(inFlight).getByText("#163 refuse long titles").closest("li")!;
    expect(drawnIcons(row)).toEqual(["unattendish-sdlc/scale"]);
    expect(row.querySelector("[data-icon]")!.parentElement!.className).toContain("text-timeline-accent");
    expect(within(row).getByRole("link", { name: "#166 ↗" }).getAttribute("href")).toBe("https://github.test/acme/web/pull/166");
    expect(within(row).getByText("at the bar for 25m")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /builder/ }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_b1");
    expect(within(within(inFlight).getByText("Brainstorm on Backlog").closest("li")!).queryByRole("button", { name: /builder/ })).toBeNull();
  });

  it("shows the hammer on both rows given two rows at stage building", async () => {
    const building = (ref: string) => ({ ...okManifest.inFlight[0]!, ref, stage: "building" as const });
    await showDetail({ manifest: { ...okManifest, inFlight: [building("#1"), building("#2")] } });
    expect(drawnIcons(section(/^In flight/)).filter((name) => name === "unattendish-sdlc/hammer")).toHaveLength(3);
  });

  it("draws each stage's own icon", async () => {
    const stages = ["building", "asking", "waiting on you", "under review", "at the bar", "round open", "brainstorming"] as const;
    await showDetail({ manifest: { ...okManifest, unreadable: [], inFlight: stages.map((stage, at) => ({ ...okManifest.inFlight[0]!, ref: `#${at}`, stage })) } });
    const rows = [...section(/^In flight/).querySelectorAll("li")];
    expect(rows.map((row) => drawnIcons(row)[0])).toEqual(["unattendish-sdlc/hammer", "MessageSquare", "BellDot", "Eye", "unattendish-sdlc/scale", "Repeat", "unattendish-sdlc/lightbulb"]);
  });
});

describe("Blocked and Landed (#258 AC6)", () => {
  it("shows a Blocked row as the blocked icon, its Ref, its link, and what it waits for, each Ref linked", async () => {
    await showDetail();
    const blocked = section(/^Blocked/);
    const row = within(blocked).getByText("#171").closest("li")!;
    expect(drawnIcons(row)[0]).toBe("Unavailable");
    expect(row.textContent).toContain("waits for #170, #172");
    expect(within(row).getByRole("link", { name: "#170" }).getAttribute("href")).toBe("https://github.test/acme/web/issues/170");
    expect(within(row).queryByRole("link", { name: "#172" })).toBeNull();
  });

  it("lists a section's own unreadable rows at its top", async () => {
    await showDetail();
    const items = section(/^Blocked/).querySelectorAll("li");
    expect(items[0]!.textContent).toContain('Unreadable row, line 22: the table has no "Blocked on" column');
    expect(screen.queryByText(/Unreadable rows/)).toBeNull();
  });

  it("shows a Landed row with the merged icon, its title, its link and its merge date and time", async () => {
    await showDetail();
    fireEvent.click(within(panel("Work")).getByRole("button", { name: /^Landed/ }));
    const row = screen.getByText("#164 read one ticket").closest("li")!;
    expect(drawnIcons(row)[0]).toBe("GitMerge");
    expect(within(row).getByRole("link", { name: "#88 ↗" })).toBeTruthy();
    expect(within(row).getByText(/^merged \d+ \w+, \d\d:\d\d$/)).toBeTruthy();
  });

  it("keeps today's empty states", async () => {
    await showDetail({ manifest: { ...okManifest, inFlight: [], blocked: [], landed: [], unreadable: [] } });
    fireEvent.click(within(panel("Work")).getByRole("button", { name: /^Landed/ }));
    for (const text of ["Nothing in flight", "Nothing blocked", "Nothing landed in the last 7 days"]) expect(screen.getByText(text)).toBeTruthy();
  });
});

describe("Notes (#258 AC7)", () => {
  it("shows each written section under its own heading as Markdown, and Nothing written. for a blank one", async () => {
    await showDetail();
    fireEvent.click(tab(/^Notes/));
    const notes = panel("Notes");
    expect(within(section(/^Backlog$/)).getByText(/An id beyond the integer range answers 503\./).textContent).toContain("Second item");
    expect(within(section(/^Standing orders$/)).getByText(/Merge grant/)).toBeTruthy();
    expect(within(section(/^Set aside$/)).getByText("Nothing written.")).toBeTruthy();
    expect(notes.contains(section(/^Backlog$/))).toBe(true);
  });

  it("says a missing or unreadable manifest in today's words", async () => {
    await showDetail({ manifest: { status: "missing" } });
    fireEvent.click(tab(/^Notes/));
    expect(screen.getByRole("tabpanel", { name: /^Notes/ }).textContent).toBe("No manifest was found at the path the fleet registered.");
    expect(within(panel("Notes")).getByText("No manifest was found at the path the fleet registered.")).toBeTruthy();
  });
});

describe("Watching (#258 AC8)", () => {
  it("shows the watched set with each item's short link and why it is watched", async () => {
    await showDetail();
    fireEvent.click(tab(/^Watching/));
    const watched = section(/^Watched set$/);
    expect(within(watched).getByText("named in In flight")).toBeTruthy();
    expect(within(watched).getByText("named in Inbox · blocked on #170")).toBeTruthy();
    expect(within(watched).getByRole("link", { name: "#163" }).getAttribute("href")).toBe("https://github.test/acme/web/issues/163");
  });

  it("says an expired credential's expiry as expired on its date, in red (#261 AC4)", async () => {
    await showDetail({ credentials: [fleetCredential({ label: "GitHub · yuser for acme", expiresAt: new Date(2026, 9, 11, 9, 0).toISOString(), expired: true })] });
    fireEvent.click(tab(/^Watching/));
    const token = screen.getByRole("listitem", { name: "Credential GitHub · yuser for acme" });
    expect(within(token).getByText("expired 11 Oct").className).toContain("text-destructive-text");
  });

  it("shows each credential as a card: logo, account, half, kind, can write, expiry, the rate limit warning and Change account…", async () => {
    await showDetail();
    fireEvent.click(tab(/^Watching/));
    const token = screen.getByRole("listitem", { name: "Credential GitHub · yuser for acme" });
    expect(within(token).getByRole("img", { name: "GitHub" })).toBeTruthy();
    expect(within(token).getByText("GitHub · yuser")).toBeTruthy();
    expect(within(token).getByText("reads the forge")).toBeTruthy();
    expect(within(token).getByText("fine-grained token")).toBeTruthy();
    expect(within(token).getByText("expires 18 Oct").className).not.toContain("text-destructive-text");
    expect(within(token).queryByText("can write")).toBeNull();
    const login = screen.getByRole("listitem", { name: "Credential GitHub · buser for every owner" });
    expect(within(login).getByText("gh login")).toBeTruthy();
    expect(within(login).getByText("no expiry reported")).toBeTruthy();
    expect(within(login).getByText("can write")).toBeTruthy();
    expect(within(login).getByText("shares the agents' rate limit").className).toContain("text-warning-text");
    fireEvent.click(within(login).getByRole("button", { name: /^Change account…/ }));
    expect(currentConnect()?.request).toMatchObject({ target: { fleet: "acme/web", role: "forge" } });
  });

  it("shows the poll interval, when it was last polled and the requests this hour", async () => {
    await showDetail();
    fireEvent.click(tab(/^Watching/));
    expect(within(section(/^Polling$/)).getByText("every 2m · polled 40s ago · 188 requests this hour")).toBeTruthy();
  });
});

describe("the Ledger (#258 AC9)", () => {
  const changes = [ledgerChange({ ref: "#163", done: "woke" }), ledgerChange({ ref: "#150", done: "echo", rule: "marker", kind: "comment added" }), ledgerChange({ ref: "#9", done: "failed read", rule: "state missing" })];
  const ledger = ledgerView({
    changes,
    dropped: [
      { reason: "echo: marker", count: 31, changes: [ledgerChange({ ref: "#150", done: "echo", rule: "marker", actor: "operator" })] },
      { reason: "out of scope", count: 4, changes: [] },
    ],
    wakes: [{ queuedAt: ago(10 * MINUTE), dispatchedAt: null, kind: "round close" }],
  });
  const openLedger = async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(tab(/^Ledger/));
    return panel("Ledger");
  };

  it("loads when its tab opens, not before", async () => {
    await showDetail();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.api.ledger).not.toHaveBeenCalled();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(tab(/^Ledger/));
    await waitFor(() => expect(fake.api.ledger).toHaveBeenCalledWith({ repo: "acme/web", filter: {} }));
  });

  it("filters by outcome through a row of pills, and by item through a search box", async () => {
    const ledgerPanel = await openLedger();
    await within(ledgerPanel).findByText("echo: marker · 31");
    const pills = within(within(ledgerPanel).getByRole("group", { name: "What was done" })).getAllByRole("button");
    expect(pills.map((pill) => pill.textContent)).toEqual(["All", "Woke", "Dropped", "Held", "Failed reads", "Wakes"]);
    expect(pills[0]!.className).toContain("rounded-full");
    fireEvent.click(within(ledgerPanel).getByRole("button", { name: "Held" }));
    await waitFor(() => expect(fake.api.ledger).toHaveBeenLastCalledWith({ repo: "acme/web", filter: { done: "held" } }));
    const search = within(ledgerPanel).getByRole("searchbox", { name: "Filter by item" });
    fireEvent.change(search, { target: { value: "#163" } });
    await waitFor(() => expect(fake.api.ledger).toHaveBeenLastCalledWith({ repo: "acme/web", filter: { item: "#163", done: "held" } }));
  });

  it("draws the changes as a timeline, each with its time, Ref, kind and actor, and its outcome's icon in the outcome's colour", async () => {
    const ledgerPanel = await openLedger();
    const woke = (await within(ledgerPanel).findByRole("link", { name: "#163" })).closest("li")!;
    expect(woke.closest("ol")).toBeTruthy();
    expect(woke.textContent).toContain("comment added");
    expect(woke.textContent).toContain("alice");
    expect(drawnIcons(woke)).toEqual(["Zap"]);
    expect(woke.querySelector("[data-icon]")!.parentElement!.className).toContain("text-warning-text");
    const failed = within(ledgerPanel).getByRole("link", { name: "#9" }).closest("li")!;
    expect(drawnIcons(failed)).toEqual(["AlertTriangle"]);
    expect(within(failed).getByText("failed read (state missing)").className).toContain("text-destructive-text");
    const echo = within(ledgerPanel).getByText("echo: marker · 31").closest("details")!.querySelector("li")!;
    expect(drawnIcons(echo)).toEqual(["ArrowTurnBackward"]);
    expect(echo.querySelector("[data-icon]")!.parentElement!.className).toContain("text-muted-foreground");
  });

  it("keeps Dropped, by reason and Wakes, each change shown once under All", async () => {
    const ledgerPanel = await openLedger();
    await within(ledgerPanel).findByText("echo: marker · 31");
    expect(within(ledgerPanel).getByText("Dropped, by reason")).toBeTruthy();
    expect(within(ledgerPanel).getByText("out of scope · 4")).toBeTruthy();
    expect(within(ledgerPanel).getByText(/round close · queued .* · not dispatched yet/)).toBeTruthy();
    expect(within(ledgerPanel).getAllByRole("link", { name: "#150" })).toHaveLength(1);
    expect(within(ledgerPanel).getByRole("link", { name: "#150" }).closest("details")).toBeTruthy();
  });

  it("hides the wakes while an item filter is set", async () => {
    const ledgerPanel = await openLedger();
    await within(ledgerPanel).findByText(/round close/);
    fireEvent.change(within(ledgerPanel).getByRole("searchbox", { name: "Filter by item" }), { target: { value: "#163" } });
    await waitFor(() => expect(within(ledgerPanel).queryByText(/round close/)).toBeNull());
  });

  it("shows the entry a cut-off listing wrote with its time, reason, window and last update, in place of a Ref, kind and actor (#263)", async () => {
    await showDetail();
    const listing = { from: "2026-10-12T08:55:00.000Z", to: "2026-10-12T09:00:00.000Z", reached: "2026-10-12T08:58:00.000Z" };
    const cut = ledgerChange({ ref: "", url: "", kind: "", actor: null, done: "out-of-scope", rule: "listing cut at its page limit", listing });
    fake.api.ledger.mockResolvedValue({ ok: true, ledger: ledgerView({ dropped: [{ reason: "out of scope: listing cut at its page limit", count: 2, changes: [cut] }] }) });
    fireEvent.click(tab(/^Ledger/));
    const heading = await screen.findByText("out of scope: listing cut at its page limit · 2");
    const item = heading.closest("details")!.querySelector("li")!;
    expect(item.textContent).toMatch(/listed .+ to .+, reached .+/);
    expect(item.textContent).toContain("out-of-scope (listing cut at its page limit)");
    expect(item.textContent).not.toContain("—");
    expect(drawnIcons(item)).toEqual(["EyeOff"]);
  });

  it("says when nothing matches", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger: ledgerView() });
    fireEvent.click(tab(/^Ledger/));
    expect(await screen.findByText("Nothing in the ledger matches.")).toBeTruthy();
  });
});

describe("the tab's icons (#258 AC15)", () => {
  it("each resolve to a bb 0.46 built-in or a declared icon", async () => {
    await showDetail({
      card: fleetCard({ waiting: 2, inFlight: 2, blocked: 1, landed: 1, manager: { state: "none", since: null }, problems: [unreadableInbox], warnings: [{ kind: "polling-late", lastPolledAt: ago(9 * MINUTE) }] }),
      lastAction: actionRecord({ state: "done", doneAt: ago(MINUTE) }),
    });
    fireEvent.click(within(panel("Work")).getByRole("button", { name: /^Landed/ }));
    fireEvent.click(tab(/^Watching/));
    fake.api.ledger.mockResolvedValue({ ok: true, ledger: ledgerView({ changes: [ledgerChange({ done: "woke" }), ledgerChange({ done: "held" }), ledgerChange({ done: "failed read" })], wakes: [{ queuedAt: ago(MINUTE), dispatchedAt: null, kind: "x" }] }) });
    fireEvent.click(tab(/^Ledger/));
    await screen.findAllByText(/held|woke/);
    const names = drawnIcons(document.body);
    expect(names.length).toBeGreaterThan(10);
    expectIconsResolve(names);
  });
});
