import { describe, expect, it } from "vitest";
import type { FleetDetailView } from "@/src/fleet/application/views";
import { ago, fleetCard, fleetDetail, ledgerChange, ledgerView, MINUTE, NOW } from "@/testing/fixtures";
import {
  credentialFacts,
  credentialService,
  droppedHeading,
  doneText,
  ledgerContent,
  ledgerFilter,
  ledgerIsEmpty,
  listingText,
  manifestProblemText,
  nextTab,
  pollingText,
  refLinks,
  reviewTarget,
  sectionCount,
  stageText,
  tabCounts,
  tabName,
  unreadableIn,
  whyText,
} from "./model";

type OkManifest = Extract<FleetDetailView["manifest"], { status: "ok" }>;
const manifest = (over: Partial<OkManifest> = {}): OkManifest => ({ status: "ok", inbox: [], unreadableInbox: [], inFlight: [], blocked: [], landed: [], unreadable: [], written: [], ...over });
const unreadableInbox = { fleet: "acme/web", managerThreadId: "thr_acme", line: 9, reason: "the table has no Ref column" };

describe("the tabs' counts (#258 AC2)", () => {
  it("counts the rows that wait in amber, the written sections and the watched items", () => {
    const counts = tabCounts(fleetDetail({ card: fleetCard({ waiting: 6 }), manifest: manifest({ written: [{ heading: "Backlog", markdown: "" }, { heading: "Set aside", markdown: "x" }] }), watched: [{ ref: "#1", url: null, why: [] }] }));
    expect(counts.work).toEqual({ count: 6, tone: "amber" });
    expect(counts.notes.count).toBe(2);
    expect(counts.watching.count).toBe(1);
  });

  it("shows no Ledger number given no read failed in the last 24 hours, and a red 1 given one did", () => {
    expect(tabCounts(fleetDetail({ failedReads: 0 })).ledger).toEqual({ count: null, tone: "red" });
    expect(tabCounts(fleetDetail({ failedReads: 1 })).ledger).toEqual({ count: 1, tone: "red" });
  });

  it("names each tab with what its count counts", () => {
    expect(tabName("work", { count: 6, tone: "amber" })).toBe("Work, 6 waiting on you");
    expect(tabName("notes", { count: 1, tone: "grey" })).toBe("Notes, 1 section");
    expect(tabName("watching", { count: 2, tone: "grey" })).toBe("Watching, 2 items watched");
    expect(tabName("ledger", { count: 1, tone: "red" })).toBe("Ledger, 1 read failed in the last 24 hours");
    expect(tabName("ledger", { count: null, tone: "red" })).toBe("Ledger");
  });
});

describe("moving between tabs", () => {
  it("moves right and left with the arrow keys, wrapping at either end, and ignores any other key", () => {
    expect(nextTab("work", "ArrowRight")).toBe("notes");
    expect(nextTab("ledger", "ArrowRight")).toBe("work");
    expect(nextTab("work", "ArrowLeft")).toBe("ledger");
    expect(nextTab("work", "Enter")).toBeNull();
  });
});

describe("Work (#258 AC3)", () => {
  it("says a missing or unreadable manifest in today's words", () => {
    expect(manifestProblemText({ status: "missing" })).toBe("No manifest was found at the path the fleet registered.");
    expect(manifestProblemText({ status: "unreadable", reason: "no heading" })).toBe("The manifest cannot be read: no heading");
    expect(manifestProblemText(manifest())).toBeNull();
  });

  it("gives each section its own unreadable rows, and counts them with its rows", () => {
    const shown = manifest({ unreadableInbox: [unreadableInbox], unreadable: [{ section: "Inbox", line: 9, reason: "x" }, { section: "In flight", line: 14, reason: "y" }] });
    expect(unreadableIn(shown, "inFlight").map((row) => row.line)).toEqual([14]);
    expect(unreadableIn(shown, "blocked")).toEqual([]);
    expect(sectionCount(shown, "inbox")).toBe(1);
    expect(sectionCount(shown, "inFlight")).toBe(1);
  });

  it("opens Review at the first row that cannot be read, in section order", () => {
    expect(reviewTarget(manifest({ unreadable: [{ section: "Blocked", line: 22, reason: "x" }, { section: "In flight", line: 14, reason: "y" }] }))).toEqual({ section: "inFlight", rowId: "fleet-tab-unreadable-inFlight-14" });
    expect(reviewTarget(manifest({ unreadableInbox: [unreadableInbox], unreadable: [{ section: "In flight", line: 14, reason: "y" }] }))).toEqual({ section: "inbox", rowId: "fleet-tab-unreadable-inbox-9" });
  });

  it("opens Review at nothing in particular for a missing manifest, whose sentence Work shows, or with nothing to review", () => {
    expect(reviewTarget({ status: "missing" })).toEqual({ section: null, rowId: null });
    expect(reviewTarget(manifest())).toEqual({ section: null, rowId: null });
  });

  it("says how long an In flight row has been at its stage", () => {
    expect(stageText({ stage: "at the bar", since: ago(25 * MINUTE) }, NOW)).toBe("at the bar for 25m");
  });

  it("links a Blocked row's Refs to the items the watched set knows", () => {
    const links = refLinks([{ ref: "#170", url: "https://github.test/issues/170" }, { ref: "#171", url: null }]);
    expect(links.get("#170")).toBe("https://github.test/issues/170");
    expect(links.has("#171")).toBe(false);
  });
});

describe("Watching (#258 AC8)", () => {
  const credential = { role: "forge", label: "GitHub · yuser for acme", account: { id: "a", label: "GitHub · yuser" }, kind: "fine-grained", auth: "token", expiresAt: null, canWrite: false, sharesAgentRateLimit: false } as const;

  it("gives every reason an item is in the watched set", () => {
    expect(whyText({ why: ["named in Inbox", "blocked on #170"] })).toBe("named in Inbox · blocked on #170");
  });

  it("says the half a credential reads, its kind, and its expiry or that none was reported", () => {
    expect(credentialFacts({ ...credential, expiresAt: "2026-10-18T12:00:00Z" })).toEqual(["reads the forge", "fine-grained token", "expires 18 Oct"]);
    expect(credentialFacts({ ...credential, role: "tracker", kind: "jira-token" })).toEqual(["reads the tracker", "API token", "no expiry reported"]);
  });

  it("takes a credential's service from its kind, for its logo", () => {
    expect(["fine-grained", "classic", "gh", "gitlab-token", "glab", "linear-key", "jira-token"].map((kind) => credentialService(kind as "gh"))).toEqual(["github", "github", "github", "gitlab", "gitlab", "linear", "jira"]);
  });

  it("says the interval, the last poll and the requests this hour", () => {
    expect(pollingText(fleetDetail({ card: fleetCard({ intervalMs: 120_000, lastPolledAt: ago(40_000) }), requestsThisHour: 188 }))).toBe("every 2m · polled 40s ago · 188 requests this hour");
  });
});

describe("the ledger's filters", () => {
  it("asks the server for an outcome it can filter by, and for an item", () => {
    expect(ledgerFilter("woke", " #163 ")).toEqual({ item: "#163", done: "woke" });
    expect(ledgerFilter("held", "")).toEqual({ done: "held" });
    expect(ledgerFilter("failed read", "")).toEqual({ done: "failed read" });
  });

  it("asks for everything where the view picks its own part", () => {
    expect(ledgerFilter("all", "")).toEqual({});
    expect(ledgerFilter("dropped", "")).toEqual({});
    expect(ledgerFilter("wakes", "#1")).toEqual({ item: "#1" });
  });

  const dropped = ledgerChange({ ref: "#150", done: "echo", rule: "marker" });
  const outOfScope = ledgerChange({ ref: "#151", done: "out-of-scope" });
  const woke = ledgerChange({ ref: "#163", done: "woke" });
  const held = ledgerChange({ ref: "#164", done: "held" });
  const wake = { queuedAt: ago(10 * MINUTE), dispatchedAt: null, kind: "round close" };
  const ledger = ledgerView({
    changes: [woke, dropped, held, outOfScope],
    dropped: [
      { reason: "echo: marker", count: 1, changes: [dropped] },
      { reason: "out of scope", count: 1, changes: [outOfScope] },
    ],
    wakes: [wake],
  });

  it("shows a change once under All: the main list holds what was not dropped, the groups what was", () => {
    const content = ledgerContent(ledger, "all", "");
    expect(content.changes).toEqual([woke, held]);
    expect(content.dropped.flatMap((group) => group.changes)).toEqual([dropped, outOfScope]);
    expect(content.wakes).toEqual([wake]);
    const shown = [...content.changes, ...content.dropped.flatMap((group) => group.changes)];
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("shows only the groups under Dropped, only the wakes under Wakes, and the server's list under an outcome", () => {
    expect(ledgerContent(ledger, "dropped", "")).toEqual({ changes: [], dropped: ledger.dropped, wakes: [] });
    expect(ledgerContent(ledger, "wakes", "")).toEqual({ changes: [], dropped: [], wakes: [wake] });
    expect(ledgerContent(ledger, "woke", "")).toEqual({ changes: ledger.changes, dropped: [], wakes: [] });
  });

  it("shows no wake while an item filter is set, since a wake carries no item", () => {
    expect(ledgerContent(ledger, "all", "#163").wakes).toEqual([]);
    expect(ledgerContent(ledger, "wakes", " #163 ").wakes).toEqual([]);
    expect(ledgerContent(ledger, "all", "  ").wakes).toEqual([wake]);
  });

  it("is empty where the filter shows nothing the ledger holds", () => {
    expect(ledgerIsEmpty(ledgerContent(ledgerView(), "all", ""))).toBe(true);
    expect(ledgerIsEmpty(ledgerContent(ledgerView({ changes: [woke] }), "dropped", ""))).toBe(true);
    expect(ledgerIsEmpty(ledgerContent(ledger, "wakes", "#1"))).toBe(true);
    expect(ledgerIsEmpty(ledgerContent(ledger, "all", ""))).toBe(false);
  });

  it("heads a dropped group with its reason and count, and says what was done with a change", () => {
    expect(droppedHeading({ reason: "echo: marker", count: 31 })).toBe("echo: marker · 31");
    expect(doneText({ done: "echo", rule: "marker" })).toBe("echo (marker)");
    expect(doneText({ done: "woke", rule: null })).toBe("woke");
  });

  it("says what a skipped listing listed and reached, and shows it under Dropped (#263)", () => {
    const listing = { from: "2026-10-12T08:55:00.000Z", to: "2026-10-12T09:00:00.000Z", reached: "2026-10-12T08:58:00.000Z" };
    expect(listingText(listing)).toMatch(/^listed .+ to .+, reached .+$/);
    const cut = ledgerChange({ ref: "", url: "", kind: "", actor: null, done: "out-of-scope", rule: "listing cut at its page limit", listing });
    const withCut = ledgerView({ dropped: [{ reason: "out of scope: listing cut at its page limit", count: 1, changes: [cut] }], changes: [cut] });
    expect(ledgerContent(withCut, "dropped", "").dropped).toHaveLength(1);
  });
});
