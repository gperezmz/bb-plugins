import { describe, expect, it } from "vitest";
import type { ReasonView } from "@/src/fleet/application/views";
import { actionRecord, ago, fleetCard, fleetsView, HOUR, inboxRow, MINUTE, NOW, unreadableInboxRow } from "@/testing/fixtures";
import {
  boardLines,
  boardOrder,
  headerCount,
  headerCountLabel,
  managerCell,
  moreLabel,
  phoneBoard,
  pollingCell,
  queueFor,
  quietLabel,
  rowAge,
  sentAgo,
  sentText,
  spendText,
  staleText,
  statusSlots,
  tabCounts,
  tabRows,
  tabsShown,
  unreadableLine,
} from "./model";

const missing: ReasonView = { code: "manifest-missing", text: "The manifest does not exist yet", fix: { kind: "fleet-tab" } };

describe("the header", () => {
  it("counts the Inbox rows across fleets, and nothing at zero or before the view arrives", () => {
    expect(headerCount({ waiting: 8 })).toBe("8");
    expect(headerCount({ waiting: 0 })).toBeNull();
    expect(headerCount(null)).toBeNull();
    expect(headerCountLabel(8)).toBe("8 waiting on you");
  });

  it("says how old the data shown is when a refresh fails", () => {
    expect(staleText(ago(3 * MINUTE), "the server is not running", Date.parse(NOW))).toEqual({
      pill: "3m old",
      hover: "Couldn't refresh: the server is not running. Showing what was loaded 3m ago.",
    });
  });
});

describe("the fleet board's order", () => {
  it("lists problems, then warnings, then the most waiting, ties in name order", () => {
    const cards = [
      fleetCard({ repo: "b/quiet" }),
      fleetCard({ repo: "a/two", waiting: 2 }),
      fleetCard({ repo: "c/late", warnings: [{ kind: "never-polled" }] }),
      fleetCard({ repo: "z/gone", reasons: [missing] }),
      fleetCard({ repo: "a/six", waiting: 6 }),
      fleetCard({ repo: "b/two", waiting: 2 }),
    ];
    expect(boardOrder(cards, NOW).map((card) => card.repo)).toEqual(["z/gone", "c/late", "a/six", "a/two", "b/two", "b/quiet"]);
  });

  it("folds quiet fleets, but never one with a problem, nor the selected one", () => {
    const cards = [fleetCard({ repo: "acme/web" }), fleetCard({ repo: "org/gone", reasons: [missing] }), fleetCard({ repo: "org/dash", waiting: 1 })];
    const lines = boardLines(cards, NOW, null);
    expect(lines.listed.map((card) => card.repo)).toEqual(["org/gone", "org/dash"]);
    expect(lines.quiet.map((card) => card.repo)).toEqual(["acme/web"]);
    expect(boardLines(cards, NOW, "acme/web").quiet).toEqual([]);
    expect(quietLabel(1)).toBe("1 quiet fleet");
    expect(quietLabel(3)).toBe("3 quiet fleets");
  });

  it("condenses to three fleets on a phone, the rest folded", () => {
    const cards = ["a", "b", "c", "d", "e"].map((name) => fleetCard({ repo: `org/${name}` }));
    expect(phoneBoard(cards, NOW)).toMatchObject({ more: 2 });
    expect(phoneBoard(cards, NOW).shown.map((card) => card.repo)).toEqual(["org/a", "org/b", "org/c"]);
    expect(moreLabel(2)).toBe("2 more fleets");
    expect(moreLabel(1)).toBe("1 more fleet");
  });
});

describe("a board line's cells", () => {
  it("say a working manager works, with no duration", () => {
    expect(managerCell({ state: "working", since: ago(HOUR) }, NOW)).toEqual({ state: "working", duration: null, words: "Manager working" });
  });

  it("say how long an idle manager has been idle", () => {
    expect(managerCell({ state: "idle", since: ago(10 * MINUTE) }, NOW)).toEqual({ state: "idle", duration: "10m", words: "Manager idle for 10m" });
  });

  it("say a fleet has no manager, with no duration", () => {
    expect(managerCell({ state: "none", since: null }, NOW)).toMatchObject({ state: "none", duration: null });
  });

  it("keep four Status slots in order, a zero left empty in its place", () => {
    expect(statusSlots(fleetCard({ blocked: 1, inFlight: 2, waiting: 6, landed: 1 })).map((slot) => slot.count)).toEqual([1, 2, 6, 1]);
    const wake = statusSlots(fleetCard({ waiting: 1 }));
    expect(wake.map((slot) => slot.count)).toEqual([null, null, 1, null]);
    expect(statusSlots(fleetCard({ waiting: 6 }))[2]!.label).toBe("6 waiting on you");
  });

  it("show spend only where it is known", () => {
    expect(spendText(fleetCard({ cost: { amount: 4.2, currency: "$", period: "since this manager started" } }))).toBe("$4.20");
    expect(spendText(fleetCard({ cost: null }))).toBeNull();
  });

  it("leave polling empty while healthy, and say when it has never run or is late", () => {
    expect(pollingCell(fleetCard(), NOW)).toBeNull();
    expect(pollingCell(fleetCard({ warnings: [{ kind: "never-polled" }] }), NOW)).toEqual({ kind: "never", text: "not yet" });
    expect(pollingCell(fleetCard({ warnings: [{ kind: "polling-late", lastPolledAt: ago(9 * MINUTE) }] }), NOW)).toEqual({ kind: "late", text: "9m late" });
  });
});

describe("the queue", () => {
  const view = fleetsView({
    inbox: [
      inboxRow({ id: "1", fleet: "org/dash", waitsFor: "answer" }),
      inboxRow({ id: "2", fleet: "org/dash", waitsFor: "answer" }),
      inboxRow({ id: "3", fleet: "org/wake", waitsFor: "answer" }),
      inboxRow({ id: "4", fleet: "org/wake", waitsFor: "answer" }),
      inboxRow({ id: "5", fleet: "org/wake", waitsFor: "grant" }),
    ],
    unreadableInbox: [unreadableInboxRow({ fleet: "org/dash" })],
    recentActions: [actionRecord({ fleet: "org/wake", state: "done", doneAt: ago(40 * MINUTE) })],
  });

  it("counts each tab, All counting the unreadable rows too", () => {
    expect(tabCounts(queueFor(view, null))).toEqual({ all: 6, answer: 4, grant: 1, ready: 0, other: 0, unreadable: 1, sent: 1 });
  });

  it("counts for the filtered fleet only", () => {
    expect(tabCounts(queueFor(view, "org/dash"))).toMatchObject({ all: 3, answer: 2, grant: 0, unreadable: 1, sent: 0 });
  });

  it("lists only the rows of the tab picked", () => {
    expect(tabRows(queueFor(view, null), "grant").rows.map((row) => row.id)).toEqual(["5"]);
    expect(tabRows(queueFor(view, null), "grant").unreadable).toEqual([]);
    expect(tabRows(queueFor(view, null), "all").unreadable).toHaveLength(1);
    expect(tabRows(queueFor(view, null), "unreadable")).toMatchObject({ rows: [] });
  });

  it("shows the Unreadable tab only while there is an unreadable row", () => {
    expect(tabsShown(tabCounts(queueFor(view, null)))).toContain("unreadable");
    expect(tabsShown(tabCounts(queueFor(view, "org/wake")))).toEqual(["all", "answer", "grant", "ready", "other", "sent"]);
  });

  it("turns a row's age amber once it has waited 8 hours", () => {
    expect(rowAge({ since: ago(20_000) }, NOW)).toEqual({ text: "20s", long: false });
    expect(rowAge({ since: ago(11 * HOUR + 36 * MINUTE) }, NOW)).toEqual({ text: "11h 36m", long: true });
    expect(rowAge({ since: ago(8 * HOUR) }, NOW).long).toBe(true);
  });

  it("says what an unreadable row is and why", () => {
    expect(unreadableLine({ line: 9, reason: "the table has no \"Waits for\" column" })).toBe("Unreadable Inbox row, line 9: the table has no \"Waits for\" column");
  });

  it("says what the operator did, and how long ago it was seen done", () => {
    const action = actionRecord({ kind: "answer", ref: "#5", what: "Which queue", state: "done", doneAt: ago(40 * MINUTE) });
    expect(`${sentText(action)} · ${sentAgo(action, NOW)}`).toBe("You answered #5 Which queue · 40m ago");
    expect(sentText(actionRecord({ kind: "grant", ref: "#6", what: "Merge it" }))).toBe("You granted #6 Merge it");
    expect(sentText(actionRecord({ kind: "build", ref: "#7", what: "Dark mode" }))).toBe("You asked to build #7 Dark mode");
  });
});
