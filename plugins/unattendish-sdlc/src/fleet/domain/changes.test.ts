import { describe, expect, it } from "vitest";
import { deriveChanges, partitionRevisit, type DeriveInput } from "./changes";
import type { ActivityEvent, ItemSnapshot, ItemState, ReadOutcome, SourceCursor, Transition } from "./model";

const labels = { spec: "spec", ready: "ready", inProgress: "in progress", needsInput: "needs input" };
const startedAt = "2026-10-12T10:00:00.000Z";
const firstSince = "2026-10-12T00:00:00.000Z";

const snapshot = (over: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  role: "forge",
  ref: "#1",
  url: "https://github.com/org/repo/issues/1",
  open: true,
  merged: false,
  fleetLabels: [],
  checks: null,
  inPartition: false,
  transitions: [],
  ...over,
});
const state = (over: Partial<ItemState> = {}): ItemState => ({ open: true, merged: false, fleetLabels: [], checks: null, inPartition: false, ...over });
const cursor = (items: Record<string, ItemState>, since = "2026-10-12T09:00:00.000Z"): SourceCursor => ({ since, items });
const outcome = (over: Partial<ReadOutcome> = {}): ReadOutcome => ({ snapshots: [], events: [], updated: [], failures: [], ...over });
const transition = (over: Partial<Transition>): Transition => ({ kind: "labelled", actor: "bob", at: "2026-10-12T09:30:00.000Z", id: "t1", ...over });
const derive = (over: Partial<DeriveInput> & { outcome: ReadOutcome }) =>
  deriveChanges({ role: "forge", prev: null, watchedRefs: new Set(), labels, startedAt, firstSince, stateOnly: false, ...over });
const kinds = (changes: { kind: string; label: string | null }[]) => changes.map((c) => (c.label === null ? c.kind : `${c.kind} ${c.label}`));

describe("first sight", () => {
  it("reports a spec or ready label on a partition item as gained", () => {
    const s = snapshot({ fleetLabels: ["spec", "ready"], inPartition: true });
    const { changes, nextCursor } = derive({ outcome: outcome({ snapshots: [s] }) });
    expect(kinds(changes)).toEqual(["labelled ready", "labelled spec"]);
    expect(nextCursor.items["forge:#1"]).toEqual(state({ fleetLabels: ["spec", "ready"], inPartition: true }));
  });

  it("reports nothing for an item outside the partition, or for the fleet's own labels", () => {
    const outside = snapshot({ fleetLabels: ["spec"] });
    const own = snapshot({ ref: "#2", fleetLabels: ["in progress", "needs input"], inPartition: true });
    expect(derive({ outcome: outcome({ snapshots: [outside, own] }), watchedRefs: new Set(["#1", "#2"]) }).changes).toEqual([]);
  });

  it("takes the actor, time and id from a matching transition, else the poll's own start", () => {
    const s = snapshot({ fleetLabels: ["ready"], inPartition: true, transitions: [transition({ label: "ready" })] });
    const [change] = derive({ outcome: outcome({ snapshots: [s] }) }).changes;
    expect(change).toMatchObject({ actor: "bob", at: "2026-10-12T09:30:00.000Z", key: "forge:#1|labelled:ready|t1" });
    const [bare] = derive({ outcome: outcome({ snapshots: [snapshot({ fleetLabels: ["ready"], inPartition: true })] }) }).changes;
    expect(bare).toMatchObject({ actor: null, at: startedAt, key: `forge:#1|labelled:ready|since:${firstSince}` });
  });

  it("uses the latest transition of the kind and label", () => {
    const s = snapshot({
      fleetLabels: ["ready"],
      inPartition: true,
      transitions: [transition({ label: "ready", id: "new", at: "2026-10-12T09:40:00.000Z" }), transition({ label: "ready", id: "old", at: "2026-10-12T09:10:00.000Z" }), transition({ label: "spec", id: "other" })],
    });
    expect(derive({ outcome: outcome({ snapshots: [s] }) }).changes[0]!.key).toBe("forge:#1|labelled:ready|new");
  });
});

describe("labels against a previous state", () => {
  it("reports a label gained and lost on a partition item", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }) });
    const gained = derive({ prev, outcome: outcome({ snapshots: [snapshot({ fleetLabels: ["spec", "ready"], inPartition: true })] }) });
    expect(kinds(gained.changes)).toEqual(["labelled ready"]);
    const lost = derive({ prev, outcome: outcome({ snapshots: [snapshot({ fleetLabels: [], inPartition: true })] }) });
    expect(kinds(lost.changes)).toEqual(["unlabelled spec"]);
  });

  it("ignores another teammate's item, in or out of the watched set aside from the fleet's own labels", () => {
    const prev = cursor({ "forge:#1": state() });
    const read = outcome({ snapshots: [snapshot({ fleetLabels: ["ready"], inPartition: false })] });
    expect(derive({ prev, outcome: read }).changes).toEqual([]);
  });

  it("reports every registered label change on a watched item, the fleet's own included", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["in progress"] }) });
    const read = outcome({ snapshots: [snapshot({ fleetLabels: ["needs input", "ready"] })] });
    const { changes } = derive({ prev, outcome: read, watchedRefs: new Set(["#1"]) });
    expect(new Set(kinds(changes))).toEqual(new Set(["labelled ready", "unlabelled in progress", "labelled needs input"]));
  });

  it("reports nothing for an item that left the partition while unwatched", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }) });
    const read = outcome({ snapshots: [snapshot({ fleetLabels: ["spec"], inPartition: false })] });
    const derived = derive({ prev, outcome: read });
    expect(derived.changes).toEqual([]);
    expect(derived.nextCursor.items["forge:#1"]!.inPartition).toBe(false);
  });

  it("keeps a change's key across two derivations from the same cursor", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }) });
    const read = (at: string) => derive({ prev, outcome: outcome({ snapshots: [snapshot({ fleetLabels: [], inPartition: true })] }), startedAt: at });
    const first = read("2026-10-12T10:00:00.000Z");
    const second = read("2026-10-12T10:02:00.000Z");
    expect(second.changes[0]!.key).toBe(first.changes[0]!.key);
    const withTransition = (at: string) =>
      derive({ prev, outcome: outcome({ snapshots: [snapshot({ inPartition: true, transitions: [transition({ kind: "unlabelled", label: "spec", id: "u9" })] })] }), startedAt: at });
    expect(withTransition("2026-10-12T10:00:00.000Z").changes[0]!.key).toBe(withTransition("2026-10-12T10:05:00.000Z").changes[0]!.key);
  });
});

describe("state", () => {
  const watched = new Set(["#1"]);
  const open = cursor({ "forge:#1": state() });

  it("reports a close, a merge and a reopen on a watched item", () => {
    const closed = derive({ prev: open, watchedRefs: watched, outcome: outcome({ snapshots: [snapshot({ open: false, transitions: [transition({ kind: "closed", actor: "carol", id: "c1" })] })] }) });
    expect(closed.changes).toMatchObject([{ kind: "closed", actor: "carol", key: "forge:#1|closed|c1" }]);
    const merged = derive({ prev: open, watchedRefs: watched, outcome: outcome({ snapshots: [snapshot({ open: false, merged: true })] }) });
    expect(kinds(merged.changes)).toEqual(["merged"]);
    const reopened = derive({ prev: cursor({ "forge:#1": state({ open: false }) }), watchedRefs: watched, outcome: outcome({ snapshots: [snapshot()] }) });
    expect(kinds(reopened.changes)).toEqual(["reopened"]);
  });

  it("reports a close as closed when it was already merged before", () => {
    const prev = cursor({ "forge:#1": state({ open: true, merged: true }) });
    expect(kinds(derive({ prev, watchedRefs: watched, outcome: outcome({ snapshots: [snapshot({ open: false, merged: true })] }) }).changes)).toEqual(["closed"]);
  });

  it("reports nothing on first sight, on an unwatched item, or without a change", () => {
    expect(derive({ watchedRefs: watched, outcome: outcome({ snapshots: [snapshot({ open: false })] }) }).changes).toEqual([]);
    expect(derive({ prev: open, outcome: outcome({ snapshots: [snapshot({ open: false })] }) }).changes).toEqual([]);
    expect(derive({ prev: open, watchedRefs: watched, outcome: outcome({ snapshots: [snapshot()] }) }).changes).toEqual([]);
  });
});

describe("checks", () => {
  const watched = new Set(["#7"]);
  const pr = (outcomeOf: "pending" | "passed" | "failed", sha = "aaa") => snapshot({ ref: "#7", url: "https://github.com/org/repo/pull/7", checks: { sha, outcome: outcomeOf } });
  const at = (item: ItemState) => cursor({ "forge:#7": item });

  it("reports final checks once per head sha", () => {
    const first = derive({ prev: at(state({ checks: { sha: "aaa", outcome: "pending", reported: false } })), watchedRefs: watched, outcome: outcome({ snapshots: [pr("passed")] }) });
    expect(first.changes).toMatchObject([{ kind: "checks passed", key: "forge:#7|checks passed|aaa", actor: null, at: startedAt }]);
    expect(first.nextCursor.items["forge:#7"]!.checks).toEqual({ sha: "aaa", outcome: "passed", reported: true });
    const again = derive({ prev: first.nextCursor, watchedRefs: watched, outcome: outcome({ snapshots: [pr("passed")] }) });
    expect(again.changes).toEqual([]);
    const pushed = derive({ prev: first.nextCursor, watchedRefs: watched, outcome: outcome({ snapshots: [pr("failed", "bbb")] }) });
    expect(kinds(pushed.changes)).toEqual(["checks failed"]);
    expect(pushed.changes[0]!.key).toBe("forge:#7|checks failed|bbb");
  });

  it("reports a final outcome never reported for a sha", () => {
    const prev = at(state({ checks: { sha: "aaa", outcome: "failed", reported: false } }));
    expect(kinds(derive({ prev, watchedRefs: watched, outcome: outcome({ snapshots: [pr("failed")] }) }).changes)).toEqual(["checks failed"]);
  });

  it("never reports pending, and keeps it unreported", () => {
    const derived = derive({ prev: at(state()), watchedRefs: watched, outcome: outcome({ snapshots: [pr("pending")] }) });
    expect(derived.changes).toEqual([]);
    expect(derived.nextCursor.items["forge:#7"]!.checks).toEqual({ sha: "aaa", outcome: "pending", reported: false });
  });

  it("takes first sight of final checks as a silent baseline", () => {
    const derived = derive({ watchedRefs: watched, outcome: outcome({ snapshots: [pr("failed")] }) });
    expect(derived.changes).toEqual([]);
    expect(derived.nextCursor.items["forge:#7"]!.checks).toEqual({ sha: "aaa", outcome: "failed", reported: true });
  });

  it("does not report checks of an unwatched item", () => {
    expect(derive({ prev: at(state()), outcome: outcome({ snapshots: [pr("passed")] }) }).changes).toEqual([]);
  });
});

describe("failures", () => {
  it("leaves a failed item as it was, gives no change for it, and holds since", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }), "forge:#2": state() });
    const read = outcome({
      snapshots: [snapshot({ ref: "#1", fleetLabels: [], inPartition: true }), snapshot({ ref: "#2", open: false })],
      failures: [{ ref: "#1", reason: "state missing" }],
    });
    const derived = derive({ prev, outcome: read, watchedRefs: new Set(["#1", "#2"]) });
    expect(kinds(derived.changes)).toEqual(["closed"]);
    expect(derived.nextCursor.items["forge:#1"]).toEqual(prev.items["forge:#1"]);
    expect(derived.nextCursor.items["forge:#2"]!.open).toBe(false);
    expect(derived.nextCursor.since).toBe(prev.since);
    expect(derived.failures).toEqual([{ ref: "#1", reason: "state missing" }]);
  });

  it("holds since on a failed listing, and at the registration time before a first cursor", () => {
    const derived = derive({ outcome: outcome({ failures: [{ ref: null, reason: "listing failed" }] }) });
    expect(derived.nextCursor.since).toBe(firstSince);
  });

  it("does not hold since for an item the service says does not exist, but does for any other failure of one item", () => {
    const prev = cursor({});
    const gone = derive({ prev, outcome: outcome({ failures: [{ ref: "#9", reason: "no such issue", kind: "not-found" }] }) });
    expect(gone.nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    const other = derive({ prev, outcome: outcome({ failures: [{ ref: "#9", reason: "no such issue", kind: "not-found" }, { ref: "#8", reason: "server error" }] }) });
    expect(other.nextCursor.since).toBe(prev.since);
    const listing = derive({ prev, outcome: outcome({ failures: [{ ref: null, reason: "listing failed", kind: "not-found" }] }) });
    expect(listing.nextCursor.since).toBe(prev.since);
  });

  it("holds since no further back than seven days before the poll's start", () => {
    const old = cursor({}, "2026-09-01T00:00:00.000Z");
    const held = derive({ prev: old, outcome: outcome({ failures: [{ ref: "#8", reason: "server error" }] }) });
    expect(held.nextCursor.since).toBe("2026-10-05T10:00:00.000Z");
    expect(derive({ prev: old, stateOnly: true, outcome: outcome() }).nextCursor.since).toBe("2026-10-05T10:00:00.000Z");
    expect(derive({ prev: cursor({}, "2026-10-08T00:00:00.000Z"), outcome: outcome({ failures: [{ ref: null, reason: "x" }] }) }).nextCursor.since).toBe("2026-10-08T00:00:00.000Z");
  });

  it("moves since to the poll's start less the overlap otherwise", () => {
    expect(derive({ outcome: outcome() }).nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    expect(derive({ outcome: outcome(), overlapMs: 10_000 }).nextCursor.since).toBe("2026-10-12T09:59:50.000Z");
  });
});

describe("stateOnly", () => {
  it("records state and reports nothing, keeping what it did not read and holding since", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }), "forge:#9": state() });
    const read = outcome({
      snapshots: [snapshot({ fleetLabels: [], inPartition: true, open: false }), snapshot({ ref: "#7", checks: { sha: "a", outcome: "passed" } })],
      events: [event({ ref: "#1" })],
    });
    const derived = derive({ prev, outcome: read, stateOnly: true, watchedRefs: new Set(["#1", "#7"]) });
    expect(derived.changes).toEqual([]);
    expect(derived.nextCursor.since).toBe(prev.since);
    expect(derived.nextCursor.items["forge:#9"]).toEqual(prev.items["forge:#9"]);
    expect(derived.nextCursor.items["forge:#1"]).toEqual(state({ open: false, inPartition: true }));
    expect(derived.nextCursor.items["forge:#7"]!.checks).toEqual({ sha: "a", outcome: "passed", reported: true });
  });
});

const event = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: "github:issuecomment:5",
  role: "forge",
  ref: "#1",
  url: "https://github.com/org/repo/issues/1#issuecomment-5",
  kind: "commented",
  actor: "alice",
  at: "2026-10-12T09:45:00.000Z",
  lastLine: "hello",
  ...over,
});

describe("events and out of scope", () => {
  it("passes through the events of watched refs, keyed by their id, with the last line", () => {
    const { changes } = derive({ watchedRefs: new Set(["#1"]), outcome: outcome({ events: [event(), event({ id: "github:issuecomment:6", ref: "#2" })] }) });
    expect(changes).toEqual([
      { key: "github:issuecomment:5", role: "forge", ref: "#1", url: "https://github.com/org/repo/issues/1#issuecomment-5", kind: "commented", label: null, actor: "alice", at: "2026-10-12T09:45:00.000Z", lastLine: "hello" },
    ]);
  });

  it("lists updated items that are not watched as out of scope", () => {
    const updated = [
      { role: "forge" as const, ref: "#1", url: "https://github.com/org/repo/issues/1", at: "2026-10-12T09:50:00.000Z" },
      { role: "forge" as const, ref: "#2", url: "https://github.com/org/repo/issues/2", at: "2026-10-12T09:51:00.000Z" },
    ];
    const { outOfScope, changes } = derive({ watchedRefs: new Set(["#1"]), outcome: outcome({ updated }) });
    expect(changes).toEqual([]);
    expect(outOfScope).toEqual([{ key: "updated:#2@2026-10-12T09:51:00.000Z", role: "forge", ref: "#2", url: "https://github.com/org/repo/issues/2", at: "2026-10-12T09:51:00.000Z" }]);
  });

  it("sorts changes by time, then key", () => {
    const { changes } = derive({
      watchedRefs: new Set(["#1"]),
      outcome: outcome({ events: [event({ id: "b", at: "2026-10-12T09:45:00.000Z" }), event({ id: "a", at: "2026-10-12T09:45:00.000Z" }), event({ id: "c", at: "2026-10-12T09:10:00.000Z" })] }),
    });
    expect(changes.map((c) => c.key)).toEqual(["c", "a", "b"]);
  });
});

describe("partitionRevisit", () => {
  it("names the partition items with a spec or ready label that are not watched", () => {
    const prev = cursor({
      "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }),
      "forge:#2": state({ fleetLabels: ["ready"], inPartition: true }),
      "forge:#3": state({ fleetLabels: ["spec"], inPartition: false }),
      "forge:#4": state({ fleetLabels: ["in progress"], inPartition: true }),
      "forge:#5": state({ fleetLabels: ["spec"], inPartition: true }),
      "tracker:ENG-1": state({ fleetLabels: ["spec"], inPartition: true }),
    });
    expect(partitionRevisit(prev, "forge", labels, new Set(["#5"]))).toEqual([
      { role: "forge", ref: "#1", url: null },
      { role: "forge", ref: "#2", url: null },
    ]);
    expect(partitionRevisit(prev, "tracker", labels, new Set())).toEqual([{ role: "tracker", ref: "ENG-1", url: null }]);
    expect(partitionRevisit(null, "forge", labels, new Set())).toEqual([]);
  });
});
