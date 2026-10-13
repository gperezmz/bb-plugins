import { describe, expect, it } from "vitest";
import { ago, ledgerChange, ledgerView, MINUTE, NOW } from "@/testing/fixtures";
import { blockedText, credentialParts, droppedHeading, doneText, ledgerFilter, ledgerContent, ledgerIsEmpty, listingText, stageText, unreadableRowText, watchedHeading, whyText } from "./model";

describe("the manifest's rows", () => {
  it("says how long an In flight row has been at its stage", () => {
    expect(stageText({ stage: "at the bar", since: ago(25 * MINUTE) }, NOW)).toBe("at the bar for 25m");
  });

  it("says what a row is blocked on", () => {
    expect(blockedText(["#170", "#171"])).toBe("blocked on #170, #171");
  });

  it("names the section, line and column of a row it cannot read", () => {
    expect(unreadableRowText({ section: "In flight", line: 14, reason: 'the table has no "Stage" column' })).toBe('unreadable in In flight, line 14: the table has no "Stage" column');
  });
});

describe("the watched set", () => {
  it("gives every reason an item is in it", () => {
    expect(whyText({ why: ["named in Inbox", "blocked on #170"] })).toBe("named in Inbox · blocked on #170");
    expect(watchedHeading(1)).toBe("Watched set (1 item)");
  });
});

describe("a credential", () => {
  const credential = { role: "forge", label: "GitHub · yuser for acme", account: { id: "a", label: "GitHub · yuser" }, kind: "fine-grained", auth: "token", expiresAt: null, canWrite: false, sharesAgentRateLimit: false } as const;

  it("names its account and kind, and its expiry date where the service reports one", () => {
    expect(credentialParts({ ...credential, expiresAt: "2026-10-18T12:00:00Z" })).toEqual(["GitHub · yuser", "fine-grained token", "expires 18 Oct"]);
    expect(credentialParts(credential)).toEqual(["GitHub · yuser", "fine-grained token", "no expiry reported"]);
  });

  it("says when it can write and when it shares the agents' rate limit", () => {
    expect(credentialParts({ ...credential, kind: "gh", auth: "gh", canWrite: true, sharesAgentRateLimit: true })).toEqual(["GitHub · yuser", "gh login", "can write", "no expiry reported", "shares the agents' rate limit"]);
    expect(credentialParts({ ...credential, kind: "classic", canWrite: true })).toContain("classic token");
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

  it("says what a cut-off listing listed and reached, and shows it once under All, in its group (#263)", () => {
    const listing = { from: "2026-10-12T08:55:00.000Z", to: "2026-10-12T09:00:00.000Z", reached: "2026-10-12T08:58:00.000Z" };
    expect(listingText(listing)).toMatch(/^listed .+ to .+, reached .+$/);
    const cut = ledgerChange({ ref: "", url: "", kind: "", actor: null, done: "out-of-scope", rule: "listing cut at its page limit", listing });
    const withCut = ledgerView({ dropped: [{ reason: "out of scope: listing cut at its page limit", count: 1, changes: [cut] }], changes: [cut] });
    expect(ledgerContent(withCut, "all", "").changes).toEqual([]);
    expect(ledgerContent(withCut, "dropped", "").dropped).toHaveLength(1);
  });
});
