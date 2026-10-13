import { describe, expect, it } from "vitest";
import { byTimeThenKey, deriveChanges, outageKind, partitionRevisit, unreadableKind, type DeriveInput } from "./changes";
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
  inPartition: false,
  transitions: [],
  ...over,
});
const state = (over: Partial<ItemState> = {}): ItemState => ({ open: true, merged: false, fleetLabels: [], inPartition: false, ...over });
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

describe("a cursor an earlier build stored with checks", () => {
  it("wakes for nothing on them and keeps the item without them", () => {
    const stored = { open: true, merged: false, fleetLabels: [], checks: { sha: "aaa", outcome: "pending", reported: false }, inPartition: false } as ItemState;
    const pr = snapshot({ ref: "#7", url: "https://github.com/org/repo/pull/7" });
    const derived = derive({ prev: cursor({ "forge:#7": stored }), watchedRefs: new Set(["#7"]), outcome: outcome({ snapshots: [pr] }) });
    expect(derived.changes).toEqual([]);
    expect(derived.nextCursor.items["forge:#7"]).toEqual(state());
  });
});

describe("reviewers' states kept on the item", () => {
  const reviewed = (reviewers: ItemSnapshot["reviewers"]) => snapshot({ ref: "!4", url: "https://gitlab.com/org/repo/-/merge_requests/4", reviewers });

  it("reports a reviewer whose state is new or changed on a watched item, keyed by item, state, reviewer and since", () => {
    const prev = cursor({ "forge:!4": state({ reviewers: { carol: "commented", dave: "approved" } }) });
    const read = outcome({ snapshots: [reviewed([{ actor: "carol", state: "changes requested" }, { actor: "dave", state: "approved" }, { actor: "erin", state: "commented" }])] });
    const { changes, nextCursor } = derive({ prev, outcome: read, watchedRefs: new Set(["!4"]) });
    expect(changes.map((change) => [change.kind, change.actor, change.key])).toEqual([
      ["reviewed: changes requested", "carol", "forge:!4|reviewed: changes requested|carol|since:2026-10-12T09:00:00.000Z"],
      ["reviewed: commented", "erin", "forge:!4|reviewed: commented|erin|since:2026-10-12T09:00:00.000Z"],
    ]);
    expect(changes[0]).toMatchObject({ ref: "!4", url: "https://gitlab.com/org/repo/-/merge_requests/4", label: null, at: startedAt, lastLine: null });
    expect(nextCursor.items["forge:!4"]!.reviewers).toEqual({ carol: "changes requested", dave: "approved", erin: "commented" });
  });

  it("takes first sight of the item, or of reviewers under a cursor that kept none, as a silent baseline", () => {
    const read = outcome({ snapshots: [reviewed([{ actor: "carol", state: "approved" }])] });
    const first = derive({ outcome: read, watchedRefs: new Set(["!4"]) });
    expect(first.changes).toEqual([]);
    expect(first.nextCursor.items["forge:!4"]!.reviewers).toEqual({ carol: "approved" });
    expect(derive({ prev: cursor({ "forge:!4": state() }), outcome: read, watchedRefs: new Set(["!4"]) }).changes).toEqual([]);
  });

  it("reports nothing for an unwatched item, and keeps no reviewers for a service that gives none", () => {
    const prev = cursor({ "forge:!4": state({ reviewers: {} }) });
    expect(derive({ prev, outcome: outcome({ snapshots: [reviewed([{ actor: "carol", state: "approved" }])] }) }).changes).toEqual([]);
    expect("reviewers" in derive({ outcome: outcome({ snapshots: [snapshot()] }) }).nextCursor.items["forge:#1"]!).toBe(false);
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

  it("does not hold since for an item the service says does not exist or that lies outside the fleet, but does for any other failure of one item", () => {
    const prev = cursor({});
    const gone = derive({ prev, outcome: outcome({ failures: [{ ref: "#9", reason: "no such issue", kind: "not-found" }] }) });
    expect(gone.nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    const moved = derive({ prev, outcome: outcome({ failures: [{ ref: "#9", reason: "moved to another repository", kind: "outside-fleet" }] }) });
    expect(moved.nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    for (const kind of ["forbidden", "unreachable"] as const) {
      expect(derive({ prev, outcome: outcome({ snapshots: [snapshot()], failures: [{ ref: "#9", reason: "x", kind }] }) }).nextCursor.since).toBe(prev.since);
    }
    const other = derive({ prev, outcome: outcome({ failures: [{ ref: "#9", reason: "no such issue", kind: "not-found" }, { ref: "#8", reason: "server error" }] }) });
    expect(other.nextCursor.since).toBe(prev.since);
    const listing = derive({ prev, outcome: outcome({ failures: [{ ref: null, reason: "listing failed", kind: "not-found" }] }) });
    expect(listing.nextCursor.since).toBe(prev.since);
  });

  it("holds since no further back than seven days before the poll's start while items fail, no listing failed and something read", () => {
    const old = cursor({}, "2026-09-01T00:00:00.000Z");
    const held = derive({ prev: old, outcome: outcome({ snapshots: [snapshot()], failures: [{ ref: "#8", reason: "server error" }] }) });
    expect(held.nextCursor.since).toBe("2026-10-05T10:00:00.000Z");
    const updated = derive({ prev: old, outcome: outcome({ updated: [{ role: "forge", ref: "#2", url: "u", at: startedAt }], failures: [{ ref: "#8", reason: "x", kind: "unreachable" }] }) });
    expect(updated.nextCursor.since).toBe("2026-10-05T10:00:00.000Z");
    expect(derive({ prev: cursor({}, "2026-10-08T00:00:00.000Z"), outcome: outcome({ snapshots: [snapshot()], failures: [{ ref: "#8", reason: "x" }] }) }).nextCursor.since).toBe("2026-10-08T00:00:00.000Z");
  });

  it("caps the hold though two items fail while one other reads", () => {
    const old = cursor({}, "2026-09-01T00:00:00.000Z");
    const failures = [{ ref: "#8", reason: "server error" }, { ref: "#9", reason: "x", kind: "forbidden" as const }];
    expect(derive({ prev: old, outcome: outcome({ snapshots: [snapshot()], failures }) }).nextCursor.since).toBe("2026-10-05T10:00:00.000Z");
  });

  it("holds since with no limit on a turn-end read, however long the outage before it", () => {
    const old = cursor({}, "2026-10-02T10:00:00.000Z");
    expect(derive({ prev: old, stateOnly: true, outcome: outcome({ snapshots: [snapshot()] }) }).nextCursor.since).toBe(old.since);
  });

  it("holds since with no limit on a failed listing, though the items read", () => {
    const old = cursor({}, "2026-09-01T00:00:00.000Z");
    const listing = { ref: null, reason: "the listing failed" };
    expect(derive({ prev: old, outcome: outcome({ snapshots: [snapshot()], failures: [listing] }) }).nextCursor.since).toBe(old.since);
    expect(derive({ prev: old, outcome: outcome({ updated: [{ role: "forge", ref: "#2", url: "u", at: startedAt }], failures: [listing] }) }).nextCursor.since).toBe(old.since);
  });

  it("holds since with no limit while nothing of the source reads", () => {
    const old = cursor({}, "2026-09-01T00:00:00.000Z");
    for (const kind of ["forbidden", "unreachable", undefined] as const) {
      const failures = [{ ref: null, reason: "the listing failed", ...(kind === undefined ? {} : { kind }) }, { ref: "#8", reason: "x", ...(kind === undefined ? {} : { kind }) }];
      expect(derive({ prev: old, outcome: outcome({ failures }) }).nextCursor.since).toBe(old.since);
    }
    expect(derive({ prev: old, stateOnly: true, outcome: outcome() }).nextCursor.since).toBe(old.since);
  });

  it("moves since to the last update a cut-off listing read, never back past the previous since", () => {
    const prev = cursor({});
    const updated = [{ role: "forge" as const, ref: "#2", url: "u", at: "2026-10-12T09:30:00.000Z" }];
    const cut = derive({ prev, outcome: outcome({ updated, listingCutAt: "2026-10-12T09:30:00.000Z" }) });
    expect(cut.nextCursor.since).toBe("2026-10-12T09:30:00.000Z");
    expect(cut.failures).toEqual([]);
    expect(derive({ prev, outcome: outcome({ updated, listingCutAt: "2026-10-12T08:00:00.000Z" }) }).nextCursor.since).toBe(prev.since);
    expect(derive({ outcome: outcome({ updated, listingCutAt: "2026-10-11T00:00:00.000Z" }) }).nextCursor.since).toBe(firstSince);
    const gone = derive({ prev, outcome: outcome({ updated, listingCutAt: "2026-10-12T09:30:00.000Z", failures: [{ ref: "#9", reason: "gone", kind: "not-found" }] }) });
    expect(gone.nextCursor.since).toBe("2026-10-12T09:30:00.000Z");
  });

  it("keeps the overlap when a cut-off listing reached a later update than the poll's start less the overlap", () => {
    const prev = cursor({});
    const updated = [{ role: "forge" as const, ref: "#2", url: "u", at: "2026-10-12T09:59:30.000Z" }];
    expect(derive({ prev, outcome: outcome({ updated, listingCutAt: "2026-10-12T09:59:30.000Z" }) }).nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    expect(derive({ prev, outcome: outcome({ updated, listingCutAt: "2026-10-12T10:05:00.000Z" }) }).nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    expect(derive({ prev, overlapMs: 10_000, outcome: outcome({ updated, listingCutAt: "2026-10-12T09:59:55.000Z" }) }).nextCursor.since).toBe("2026-10-12T09:59:50.000Z");
    const late = cursor({}, "2026-10-12T09:59:45.000Z");
    expect(derive({ prev: late, outcome: outcome({ updated, listingCutAt: "2026-10-12T09:59:50.000Z" }) }).nextCursor.since).toBe("2026-10-12T09:59:45.000Z");
  });

  it("moves since as after a listing that fit where a cut-off listing got no further than the cursor (skipped), and reports it", () => {
    const prev = cursor({});
    const listingSkipped = { from: "2026-10-12T08:55:00.000Z", to: startedAt, reached: prev.since };
    const skipped = derive({ prev, outcome: outcome({ listingSkipped }) });
    expect(skipped.nextCursor.since).toBe(derive({ prev, outcome: outcome() }).nextCursor.since);
    expect(skipped.nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    expect(skipped.failures).toEqual([]);
    expect(skipped.skipped).toEqual(listingSkipped);
    expect(derive({ prev, outcome: outcome() }).skipped).toBeNull();
    expect(derive({ prev, overlapMs: 10_000, outcome: outcome({ listingSkipped }) }).nextCursor.since).toBe("2026-10-12T09:59:50.000Z");
  });

  it("does not move since on a skipped listing while an item failure holds it, or on a turn-end read", () => {
    const prev = cursor({});
    const listingSkipped = { from: "2026-10-12T08:55:00.000Z", to: startedAt, reached: prev.since };
    expect(derive({ prev, outcome: outcome({ listingSkipped, failures: [{ ref: "#8", reason: "server error" }] }) }).nextCursor.since).toBe(prev.since);
    expect(derive({ prev, stateOnly: true, outcome: outcome({ listingSkipped }) }).nextCursor.since).toBe(prev.since);
  });

  it("does not move since to a cut-off listing's last update while an item failure holds it, or on a turn-end read", () => {
    const prev = cursor({});
    const updated = [{ role: "forge" as const, ref: "#2", url: "u", at: "2026-10-12T09:30:00.000Z" }];
    const listingCutAt = "2026-10-12T09:30:00.000Z";
    expect(derive({ prev, outcome: outcome({ updated, listingCutAt, failures: [{ ref: "#8", reason: "server error" }] }) }).nextCursor.since).toBe(prev.since);
    expect(derive({ prev, stateOnly: true, outcome: outcome({ updated, listingCutAt }) }).nextCursor.since).toBe(prev.since);
    const old = cursor({}, "2026-09-01T00:00:00.000Z");
    expect(derive({ prev: old, outcome: outcome({ updated, listingCutAt, failures: [{ ref: "#8", reason: "server error" }] }) }).nextCursor.since).toBe("2026-10-05T10:00:00.000Z");
  });

  it("moves since to the poll's start less the overlap otherwise", () => {
    expect(derive({ outcome: outcome() }).nextCursor.since).toBe("2026-10-12T09:59:00.000Z");
    expect(derive({ outcome: outcome(), overlapMs: 10_000 }).nextCursor.since).toBe("2026-10-12T09:59:50.000Z");
  });
});

describe("stateOnly", () => {
  it("takes as the baseline of an item the cursor does not know its state before the transitions listed, undone latest first", () => {
    const read = outcome({
      snapshots: [
        snapshot({
          ref: "#9",
          open: false,
          merged: true,
          fleetLabels: ["ready", "spec"],
          transitions: [
            transition({ kind: "unlabelled", label: "spec", id: "u1", at: "2026-10-12T09:10:00.000Z" }),
            transition({ kind: "labelled", label: "spec", id: "l0", at: "2026-10-12T09:20:00.000Z" }),
            transition({ kind: "labelled", label: "ready", id: "l1", at: "2026-10-12T09:30:00.000Z" }),
            transition({ kind: "merged", id: "m1", at: "2026-10-12T09:40:00.000Z" }),
          ],
        }),
        snapshot({ ref: "#4", open: true, fleetLabels: [], transitions: [transition({ kind: "closed", id: "c1" }), transition({ kind: "reopened", id: "r1", at: "2026-10-12T09:50:00.000Z" })] }),
        snapshot({ ref: "#5", open: true, fleetLabels: [], transitions: [transition({ kind: "reopened", id: "r2" })] }),
      ],
    });
    const prev = cursor({ "forge:#7": state({ fleetLabels: ["ready"] }) });
    const { nextCursor, changes } = derive({ prev, outcome: read, stateOnly: true, watchedRefs: new Set(["#9", "#4", "#5", "#7"]) });
    expect(changes).toEqual([]);
    expect(nextCursor.items["forge:#9"]).toEqual(state({ open: true, merged: false, fleetLabels: ["spec"] }));
    expect(nextCursor.items["forge:#4"]).toEqual(state({ open: true }));
    expect(nextCursor.items["forge:#5"]).toEqual(state({ open: false }));

    const later = derive({ prev: nextCursor, outcome: outcome({ snapshots: [read.snapshots[0]!] }), watchedRefs: new Set(["#9"]) });
    expect(later.changes.map((change) => change.key)).toEqual(["forge:#9|labelled:ready|l1", "forge:#9|merged|m1"]);
  });

  it("keeps a label an item the cursor does not know carried before its listed transitions, so the next poll does not report it", () => {
    const read = outcome({ snapshots: [snapshot({ ref: "#9", fleetLabels: ["ready"], inPartition: true })] });
    const { nextCursor } = derive({ outcome: read, stateOnly: true, watchedRefs: new Set(["#9"]) });
    expect(nextCursor.items["forge:#9"]!.fleetLabels).toEqual(["ready"]);
    expect(derive({ prev: nextCursor, outcome: read, watchedRefs: new Set(["#9"]) }).changes).toEqual([]);
  });

  it("keeps the state an item the cursor knows reads as, whatever its transitions", () => {
    const prev = cursor({ "forge:#9": state() });
    const read = outcome({ snapshots: [snapshot({ ref: "#9", fleetLabels: ["ready"], transitions: [transition({ label: "ready" })] })] });
    expect(derive({ prev, outcome: read, stateOnly: true, watchedRefs: new Set(["#9"]) }).nextCursor.items["forge:#9"]).toEqual(state({ fleetLabels: ["ready"] }));
  });

  it("records state and reports nothing, keeping what it did not read and holding since", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }), "forge:#9": state() });
    const read = outcome({
      snapshots: [snapshot({ fleetLabels: [], inPartition: true, open: false })],
      events: [event({ ref: "#1" })],
    });
    const derived = derive({ prev, outcome: read, stateOnly: true, watchedRefs: new Set(["#1"]) });
    expect(derived.changes).toEqual([]);
    expect(derived.nextCursor.since).toBe(prev.since);
    expect(derived.nextCursor.items["forge:#9"]).toEqual(prev.items["forge:#9"]);
    expect(derived.nextCursor.items["forge:#1"]).toEqual(state({ open: false, inPartition: true }));
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

  it("carries the other names the service knows an actor by from an event and from a transition, and leaves the field out otherwise", () => {
    const watchedOne = new Set(["#1"]);
    const viaEvent = derive({ watchedRefs: watchedOne, outcome: outcome({ events: [event({ actorAliases: ["bot@example.com"] }), event({ id: "e2", actorAliases: [] })] }) }).changes;
    expect(viaEvent.find((c) => c.key === "github:issuecomment:5")!.actorAliases).toEqual(["bot@example.com"]);
    expect("actorAliases" in viaEvent.find((c) => c.key === "e2")!).toBe(false);
    const prev = cursor({ "forge:#1": state() });
    const labelled = snapshot({ fleetLabels: ["in progress"], transitions: [transition({ label: "in progress", actorAliases: ["bot@example.com"] })] });
    const [viaTransition] = derive({ prev, watchedRefs: watchedOne, outcome: outcome({ snapshots: [labelled] }) }).changes;
    expect(viaTransition!.actorAliases).toEqual(["bot@example.com"]);
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

  it("leaves out a closed item", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true, open: false }), "forge:#2": state({ fleetLabels: ["ready"], inPartition: true, open: false, merged: true }) });
    expect(partitionRevisit(prev, "forge", labels, new Set())).toEqual([]);
  });

  it("pins, as it behaves now and left for a follow-up: a reopened partition item wakes as labelled for its old label, not as reopened", () => {
    const closed = derive({ prev: cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }) }), outcome: outcome({ snapshots: [snapshot({ fleetLabels: ["spec"], inPartition: true, open: false })] }) });
    expect(closed.nextCursor.items).toEqual({});
    const reopened = snapshot({ fleetLabels: ["spec"], inPartition: true, transitions: [transition({ kind: "reopened", id: "r1", at: "2026-10-12T09:50:00.000Z" })] });
    const { changes } = derive({ prev: closed.nextCursor, outcome: outcome({ snapshots: [reopened] }) });
    expect(kinds(changes)).toEqual(["labelled spec"]);
  });

  it("is given no closed item by the cursor a read of it leaves, unless the item is watched", () => {
    const prev = cursor({ "forge:#1": state({ fleetLabels: ["spec"], inPartition: true }), "forge:#2": state({ fleetLabels: ["spec"], inPartition: true }) });
    const read = outcome({ snapshots: [snapshot({ ref: "#1", fleetLabels: ["spec"], inPartition: true, open: false }), snapshot({ ref: "#2", fleetLabels: ["spec"], inPartition: true, open: false })] });
    const { nextCursor } = derive({ prev, outcome: read, watchedRefs: new Set(["#2"]) });
    expect(Object.keys(nextCursor.items)).toEqual(["forge:#2"]);
    expect(partitionRevisit(nextCursor, "forge", labels, new Set())).toEqual([]);
  });
});

describe("unreadableKind", () => {
  const forbidden = { ref: null, reason: "403", kind: "forbidden" as const };
  const unreachable = { ref: "#1", reason: "no answer", kind: "unreachable" as const };

  const listingGone = { ref: null, reason: "404", kind: "not-found" as const };
  const itemGone = { ref: "#3", reason: "gone", kind: "not-found" as const };
  const listingMoved = { ref: null, reason: "moved", kind: "outside-fleet" as const };
  const itemMoved = { ref: "#4", reason: "moved", kind: "outside-fleet" as const };

  it("says forbidden when any failure is, else unreachable, when nothing but those failures came back", () => {
    expect(unreadableKind(outcome({ failures: [unreachable, forbidden] }))).toBe("forbidden");
    expect(unreadableKind(outcome({ failures: [unreachable] }))).toBe("unreachable");
  });

  it("says not-found or outside-fleet when every read, the listing's among them, failed so", () => {
    expect(unreadableKind(outcome({ failures: [listingGone, itemGone] }))).toBe("not-found");
    expect(unreadableKind(outcome({ failures: [listingMoved, itemMoved] }))).toBe("outside-fleet");
  });

  it("reports mixed kinds in the order forbidden, unreachable, not-found, outside-fleet", () => {
    expect(unreadableKind(outcome({ failures: [itemGone, forbidden, unreachable, listingMoved] }))).toBe("forbidden");
    expect(unreadableKind(outcome({ failures: [listingMoved, itemGone, unreachable] }))).toBe("unreachable");
    expect(unreadableKind(outcome({ failures: [listingMoved, itemGone] }))).toBe("not-found");
  });

  it("is null for an item that does not exist or moved while the listing read", () => {
    expect(unreadableKind(outcome({ failures: [itemGone] }))).toBeNull();
    expect(unreadableKind(outcome({ failures: [itemMoved, itemGone] }))).toBeNull();
    expect(unreadableKind(outcome({ failures: [itemGone], snapshots: [snapshot()] }))).toBeNull();
    expect(unreadableKind(outcome({ failures: [listingGone], updated: [{ role: "forge", ref: "#2", url: "u", at: startedAt }] }))).toBeNull();
  });

  it("is null when anything came back, when there is no failure, or when a failure is of another kind", () => {
    expect(unreadableKind(outcome())).toBeNull();
    expect(unreadableKind(outcome({ failures: [forbidden], snapshots: [snapshot()] }))).toBeNull();
    expect(unreadableKind(outcome({ failures: [forbidden], events: [event()] }))).toBeNull();
    expect(unreadableKind(outcome({ failures: [forbidden], updated: [{ role: "forge", ref: "#2", url: "u", at: startedAt }] }))).toBeNull();
    expect(unreadableKind(outcome({ failures: [unreachable, { ref: null, reason: "field missing" }] }))).toBeNull();
  });
});

describe("byTimeThenKey", () => {
  it("orders by time, then by key", () => {
    const rows = [{ at: "2026-10-12T10:00:02.000Z", key: "a" }, { at: "2026-10-12T10:00:01.000Z", key: "z" }, { at: "2026-10-12T10:00:01.000Z", key: "b" }, { at: "2026-10-12T10:00:01.000Z", key: "b" }];
    expect([...rows].sort(byTimeThenKey).map((row) => `${row.at.slice(17, 19)}${row.key}`)).toEqual(["01b", "01b", "01z", "02a"]);
    expect(byTimeThenKey(rows[2]!, rows[3]!)).toBe(0);
  });
});

describe("outageKind", () => {
  const listing = { ref: null, reason: "the listing answered 422" };

  it("says how every read failed where unreadableKind does", () => {
    expect(outageKind(outcome({ failures: [{ ref: null, reason: "403", kind: "forbidden" }] }))).toBe("forbidden");
  });

  it("says listing-failed for a failed listing, of any kind or none, though items read", () => {
    expect(outageKind(outcome({ snapshots: [snapshot()], failures: [listing] }))).toBe("listing-failed");
    expect(outageKind(outcome({ events: [event()], failures: [{ ...listing, kind: "forbidden" }] }))).toBe("listing-failed");
    expect(outageKind(outcome({ failures: [listing, { ref: "#1", reason: "no answer", kind: "unreachable" }] }))).toBe("listing-failed");
  });

  it("is null where only items failed, or the listing was cut off at its page limit", () => {
    expect(outageKind(outcome({ snapshots: [snapshot()], failures: [{ ref: "#2", reason: "403", kind: "forbidden" }] }))).toBeNull();
    expect(outageKind(outcome({ snapshots: [snapshot()], listingCutAt: startedAt }))).toBeNull();
    expect(outageKind(outcome({ snapshots: [snapshot()], listingSkipped: { from: firstSince, to: startedAt, reached: firstSince } }))).toBeNull();
    expect(outageKind(outcome({ listingSkipped: { from: firstSince, to: startedAt, reached: firstSince } }))).toBeNull();
    expect(outageKind(outcome())).toBeNull();
  });
});
