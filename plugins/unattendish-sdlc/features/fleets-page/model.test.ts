import { describe, expect, it } from "vitest";
import type { ProblemView } from "@/src/fleet/application/views";
import { actionRecord, ago, fleetCard, fleetsView, HOUR, inboxRow, MINUTE, NOW, unreadableInboxRow } from "@/testing/fixtures";
import {
  boardLines,
  composerFor,
  filterShowing,
  goneText,
  requestedRow,
  tabShowing,
  boardOrder,
  headerCount,
  headerCountLabel,
  moreLabel,
  phoneBoard,
  pollingCell,
  queueFor,
  quietLabel,
  shortNames,
  staleText,
  tabCounts,
  tabRows,
  tabsShown,
} from "./model";

const missing: ProblemView = { code: "manifest-missing", text: "The manifest does not exist yet", fix: { kind: "fleet-tab" } };

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
      fleetCard({ repo: "z/gone", problems: [missing] }),
      fleetCard({ repo: "a/six", waiting: 6 }),
      fleetCard({ repo: "b/two", waiting: 2 }),
    ];
    expect(boardOrder(cards, NOW).map((card) => card.repo)).toEqual(["z/gone", "c/late", "a/six", "a/two", "b/two", "b/quiet"]);
  });

  it("folds quiet fleets, but never one with a problem, nor the selected one", () => {
    const cards = [fleetCard({ repo: "acme/web" }), fleetCard({ repo: "org/gone", problems: [missing] }), fleetCard({ repo: "org/dash", waiting: 1 })];
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
});

describe("a fleet's short name (AC3)", () => {
  const short = (...fleets: string[]) => [...shortNames(fleets).values()];

  it("is the last segment where no other fleet ends the same way", () => {
    expect(short("github.example/org/dash", "github.example/org/wake")).toEqual(["dash", "wake"]);
    expect(short("gitlab.example/group/sub/proj", "github.example/org/dash")).toEqual(["proj", "dash"]);
  });

  it("takes one more segment at a time until it tells the fleets apart", () => {
    expect(short("github.example/org/dash", "github.example/other/dash")).toEqual(["org/dash", "other/dash"]);
  });

  it("keeps the host only where the whole path ends another fleet's name", () => {
    expect(short("github.example/org/dash", "gitlab.example/org/dash")).toEqual(["github.example/org/dash", "gitlab.example/org/dash"]);
    expect(short("gitlab.example/b/dash", "gitlab.example/a/b/dash")).toEqual(["gitlab.example/b/dash", "a/b/dash"]);
  });

  it("matches whole segments, not the end of one", () => {
    expect(short("github.example/org/dash", "github.example/org/mydash")).toEqual(["dash", "mydash"]);
  });

  it("shortens again once the fleet it was told apart from is gone", () => {
    expect(short("github.example/org/dash")).toEqual(["dash"]);
  });
});

describe("the row a toast opens", () => {
  const dash = inboxRow({ fleet: "org/dash", id: "row_7", ref: "#7", what: "Which cache to use", waitsFor: "answer" });
  const wake = inboxRow({ fleet: "org/wake", id: "row_7", waitsFor: "grant" });

  it("is found by its fleet and its id, so two fleets' rows with the same id stay apart; a row gone finds nothing", () => {
    const view = fleetsView({ inbox: [wake, dash] });
    expect(requestedRow(view, { fleet: "org/dash", rowId: "row_7" })).toBe(dash);
    expect(requestedRow(view, { fleet: "org/dash", rowId: "row_8" })).toBeNull();
  });

  it("clears a filter to another fleet, and keeps one that already shows it (AC3)", () => {
    expect(filterShowing("org/wake", dash)).toBeNull();
    expect(filterShowing("org/dash", dash)).toBe("org/dash");
    expect(filterShowing(null, dash)).toBeNull();
  });

  it("shows All for a tab that hides it, and keeps one that lists it (AC3)", () => {
    const queue = queueFor(fleetsView({ inbox: [wake, dash] }), null);
    expect(tabShowing(queue, "grant", dash)).toBe("all");
    expect(tabShowing(queue, "sent", dash)).toBe("all");
    expect(tabShowing(queue, "answer", dash)).toBe("answer");
    expect(tabShowing(queue, "all", dash)).toBe("all");
  });

  it("opens the composer its own button opens, and none while its action is under way, sent or done (AC4)", () => {
    const offer = (kind: "answer" | "grant" | "build") => ({ kind: "offer" as const, offer: { kind, label: "x", regrant: false }, refusal: null, unconfirmed: false });
    expect(composerFor(offer("answer"))).toBe("answer");
    expect(composerFor(offer("grant"))).toBe("grant");
    expect(composerFor(offer("build"))).toBeNull();
    expect(composerFor({ kind: "sending", text: "sending…" })).toBeNull();
    expect(composerFor({ kind: "unknown", text: "checking…" })).toBeNull();
    expect(composerFor({ kind: "sent", text: "sent · 2m" })).toBeNull();
    expect(composerFor({ kind: "done", text: "done" })).toBeNull();
    expect(composerFor({ kind: "none" })).toBeNull();
  });

  it("says a row gone from the Inbox no longer waits on you (AC4)", () => {
    expect(goneText({ ref: "#7", what: "Which cache to use" })).toBe("#7 Which cache to use no longer waits on you");
  });
});
