// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { actionRecord, ago, fleetCard, fleetDetail, HOUR, inboxRow, landedRow, ledgerChange, ledgerView, MINUTE, unreadableInboxRow } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { setCompactViewport } from "@/testing/viewport";
import { FleetTab } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  setCompactViewport(false);
  fake.api.threadFleet.mockResolvedValue({ kind: "manager", card: fleetCard() });
});
afterEach(cleanup);

const okManifest = {
  status: "ok",
  inbox: [inboxRow()],
  unreadableInbox: [unreadableInboxRow({ line: 9 })],
  inFlight: [
    { ref: "#163", work: "refuse long titles", stage: "at the bar", since: ago(25 * MINUTE), builderThreadId: "thr_b1", link: { kind: "url", url: "https://github.test/pull/166", text: "!166" } },
    { ref: "—", work: "Brainstorm on Backlog", stage: "brainstorming", since: ago(8 * MINUTE), builderThreadId: null, link: { kind: "url", url: "https://github.test/x", text: "notes" } },
  ],
  blocked: [{ ref: "#171", blockedOn: ["#170"], link: { kind: "url", url: "https://github.test/issues/171", text: "#171" } }],
  landed: [landedRow({ ref: "#164", spec: "read one ticket" })],
  unreadable: [{ section: "Blocked", line: 22, reason: 'the table has no "Blocked on" column' }],
  written: [
    { heading: "Backlog", markdown: "- An id beyond the integer range answers 503.\n- Second item" },
    { heading: "Set aside", markdown: "" },
    { heading: "Standing orders", markdown: "**Merge grant:** merge what clears the bar." },
  ],
} as const;

const showDetail = async (over = {}) => {
  fake.api.fleetDetail.mockResolvedValue({
    ok: true,
    detail: fleetDetail({
      manifest: okManifest,
      watched: [
        { ref: "#163", url: "https://github.test/issues/163", why: ["named in In flight"] },
        { ref: "#171", url: null, why: ["named in Inbox", "blocked on #170"] },
      ],
      credentials: [
        { role: "forge", prefix: "org", auth: "token", expiresAt: "2026-10-18T12:00:00Z", sharesAgentRateLimit: false },
        { role: "forge", prefix: "github.com", auth: "gh", expiresAt: null, sharesAgentRateLimit: true },
      ],
      requestsThisHour: 188,
      ...over,
    }),
  });
  render(<FleetTab threadId="thr_acme" />);
  await screen.findByRole("heading", { name: "Credentials" });
};

describe("a thread with no registration", () => {
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
});

describe("the whole manifest", () => {
  it("shows the Inbox with its actions and its unreadable rows", async () => {
    await showDetail();
    const inbox = screen.getByRole("heading", { name: "Waits on you" }).parentElement!;
    expect(within(inbox).getByRole("button", { name: "Answer… ENG-212" })).toBeTruthy();
    expect(within(inbox).getByText(/unreadable:/)).toBeTruthy();
    expect(within(inbox).queryByRole("columnheader", { name: "Fleet" })).toBeNull();
  });

  it("shows In flight with how long each row has been at its stage and links to its builder and its item", async () => {
    await showDetail();
    const section = screen.getByRole("heading", { name: "In flight" }).parentElement!;
    expect(within(section).getByText("at the bar for 25m")).toBeTruthy();
    expect(within(section).getByText("brainstorming for 8m")).toBeTruthy();
    expect(within(section).getAllByRole("button", { name: /builder/ })).toHaveLength(1);
    fireEvent.click(within(section).getByRole("button", { name: /builder/ }));
    expect(sdk.navigate.toThread).toHaveBeenCalledWith("thr_b1");
    expect(within(section).getByRole("link", { name: /!166/ }).getAttribute("href")).toBe("https://github.test/pull/166");
  });

  it("shows Blocked with what each row is blocked on", async () => {
    await showDetail();
    expect(within(screen.getByRole("heading", { name: "Blocked" }).parentElement!).getByText("blocked on #170")).toBeTruthy();
  });

  it("shows Landed for the last 7 days with a link to each pull request", async () => {
    await showDetail();
    const section = screen.getByRole("heading", { name: /Landed/ }).parentElement!;
    expect(within(section).getByText("#164 read one ticket")).toBeTruthy();
    expect(within(section).getByRole("link", { name: /#88/ })).toBeTruthy();
  });

  it("shows the sections kept as written, each as Markdown", async () => {
    await showDetail();
    expect(within(screen.getByRole("heading", { name: "Backlog" }).parentElement!).getByText(/An id beyond the integer range answers 503\./).textContent).toContain("Second item");
    expect(within(screen.getByRole("heading", { name: "Standing orders" }).parentElement!).getByText(/Merge grant/)).toBeTruthy();
    expect(within(screen.getByRole("heading", { name: "Set aside" }).parentElement!).getByText("Nothing written.")).toBeTruthy();
  });

  it("shows a row it cannot read as unreadable, naming the section, line and column", async () => {
    await showDetail();
    expect(screen.getByText('unreadable in Blocked, line 22: the table has no "Blocked on" column')).toBeTruthy();
  });

  it("says a missing manifest is missing", async () => {
    await showDetail({ manifest: { status: "missing" } });
    expect(screen.queryByRole("heading", { name: "In flight" })).toBeNull();
    expect(screen.getByText("No manifest was found at the path the fleet registered.")).toBeTruthy();
  });

  it("says an unreadable manifest is unreadable and why", async () => {
    fake.api.fleetDetail.mockResolvedValue({ ok: true, detail: fleetDetail({ manifest: { status: "unreadable", reason: "the first line is not a Fleet heading" } }) });
    render(<FleetTab threadId="thr_acme" />);
    expect(await screen.findByText("The manifest cannot be read: the first line is not a Fleet heading")).toBeTruthy();
  });

  it("shows an action sent from the dashboard as sent in the tab's Inbox too", async () => {
    await showDetail({ manifest: { ...okManifest, inbox: [inboxRow({ offer: null, action: actionRecord({ sentAt: ago(HOUR) }) })] } });
    expect(screen.getByText("sent · 1h")).toBeTruthy();
  });

  it("fails in words when the fleet cannot be loaded", async () => {
    fake.api.fleetDetail.mockResolvedValue({ ok: false, reason: "no fleet is registered for acme/web" });
    render(<FleetTab threadId="thr_acme" />);
    expect((await screen.findByRole("alert")).textContent).toContain("no fleet is registered for acme/web");
  });
});

describe("what is watched, and how", () => {
  it("shows the watched set with why each item is in it", async () => {
    await showDetail();
    const section = screen.getByRole("heading", { name: "Watched set (2 items)" }).parentElement!;
    expect(within(section).getByText("named in In flight")).toBeTruthy();
    expect(within(section).getByText("named in Inbox · blocked on #170")).toBeTruthy();
    expect(within(section).getByRole("link", { name: "#163" }).getAttribute("href")).toBe("https://github.test/issues/163");
  });

  it("shows each credential with its prefix, kind, expiry date and whether it shares the rate limit", async () => {
    await showDetail();
    const section = screen.getByRole("heading", { name: "Credentials" }).parentElement!;
    expect(within(section).getByText("org")).toBeTruthy();
    expect(within(section).getByText("pasted token")).toBeTruthy();
    expect(within(section).getByText("expires 18 Oct")).toBeTruthy();
    expect(within(section).getByText("gh login")).toBeTruthy();
    expect(within(section).getByText("shares the agents' rate limit")).toBeTruthy();
  });

  it("shows the poll interval, when it was last polled and the requests spent this hour", async () => {
    await showDetail();
    expect(within(screen.getByRole("heading", { name: "Polling" }).parentElement!).getByText("every 2m · polled 40s ago · 188 requests this hour")).toBeTruthy();
  });

  it("shows the card with its cost and reasons, and no link back to this tab", async () => {
    await showDetail({
      card: fleetCard({
        cost: { amount: 14.2, currency: "USD", period: "since this manager started" },
        reasons: [
          { code: "credential-refused", text: "Linear is not watched: token refused", fix: { kind: "settings" } },
          { code: "unreadable-rows", text: "1 manifest row cannot be read, in Blocked", fix: { kind: "fleet-tab" } },
        ],
      }),
    });
    expect(screen.queryByRole("button", { name: "Open the Fleet tab" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Fleet tab/ })).toBeNull();
    expect(screen.getByText(/\$14\.20 since this manager started/)).toBeTruthy();
    expect(screen.getByText("Linear is not watched: token refused")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Fleet acme/web" })).queryByRole("button", { name: /Open the Fleet tab of/ })).toBeNull();
  });
});

describe("the ledger", () => {
  const changes = [ledgerChange({ ref: "#163", done: "woke" }), ledgerChange({ ref: "#150", done: "echo", rule: "marker", kind: "comment added" })];
  const ledger = ledgerView({
    changes,
    dropped: [
      { reason: "echo: marker", count: 31, changes: [ledgerChange({ ref: "#150", done: "echo", rule: "marker", actor: "operator" })] },
      { reason: "out of scope", count: 4, changes: [] },
    ],
    wakes: [{ queuedAt: ago(10 * MINUTE), dispatchedAt: null, kind: "round close" }],
  });

  it("is not fetched until its section is opened", async () => {
    await showDetail();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.api.ledger).not.toHaveBeenCalled();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    await waitFor(() => expect(fake.api.ledger).toHaveBeenCalledWith({ repo: "acme/web", filter: {} }));
  });

  it("groups dropped changes by reason with a count, each group expandable", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    const marker = await screen.findByText("echo: marker · 31");
    expect(screen.getByText("out of scope · 4")).toBeTruthy();
    expect(marker.closest("details")!.querySelector("li")).toBeTruthy();
  });

  it("lists the changes and the wakes", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    expect(await screen.findByText("woke")).toBeTruthy();
    expect(screen.getByText(/round close · queued .* · not dispatched yet/)).toBeTruthy();
  });

  it("shows a dropped change once under All: in its group, not in the main list", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    await screen.findByText("echo: marker · 31");
    // #150 is the one dropped change; #163 the one that woke.
    const body = within(document.getElementById("tab-ledger-body")!);
    expect(body.getAllByText("#163")).toHaveLength(1);
    expect(body.getAllByText("#150")).toHaveLength(1);
    expect(body.getByText("#150").closest("details")).toBeTruthy();
    expect(body.getByText("#163").closest("details")).toBeNull();
  });

  it("hides the wakes while an item filter is set", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    await screen.findByText(/round close/);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter by item" }), { target: { value: "#163" } });
    await waitFor(() => expect(screen.queryByText(/round close/)).toBeNull());
  });

  it("filters by item, once the typing pauses", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    await screen.findByText("echo: marker · 31");
    fireEvent.change(screen.getByRole("textbox", { name: "Filter by item" }), { target: { value: "#163" } });
    await waitFor(() => expect(fake.api.ledger).toHaveBeenLastCalledWith({ repo: "acme/web", filter: { item: "#163" } }));
  });

  it("filters by what was done", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    await screen.findByText("echo: marker · 31");
    fireEvent.click(screen.getByRole("button", { name: "Held" }));
    await waitFor(() => expect(fake.api.ledger).toHaveBeenLastCalledWith({ repo: "acme/web", filter: { done: "held" } }));
    fireEvent.click(screen.getByRole("button", { name: "Dropped" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dropped" }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByText("echo: marker · 31")).toBeTruthy();
    expect(screen.queryByText(/round close/)).toBeNull();
  });

  it("says when nothing matches", async () => {
    await showDetail();
    fake.api.ledger.mockResolvedValue({ ok: true, ledger: ledgerView() });
    fireEvent.click(screen.getByRole("button", { name: /Ledger/ }));
    expect(await screen.findByText("Nothing in the ledger matches.")).toBeTruthy();
  });
});
