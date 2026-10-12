// The Store port's behaviour as one suite, run over every implementation so
// the in-memory fake cannot drift from the SQLite store.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionRecord } from "../domain/actions";
import type { LedgerRow, PollRecord, SourceOutage, Store, StoredFleet, StoredWake } from "../application/ports";
import { repoId } from "../domain/identity";
import type { Registration, SourceCursor } from "../domain/model";

const REPO = "github.com/org/repo";
const OTHER = "gitlab.com/group/project";

const registration = (repo: string = REPO, over: Partial<Registration> = {}): Registration => {
  const [host, ...path] = repo.split("/") as [string, ...string[]];
  return {
    repo: { host, path: path.join("/") },
    managerThreadId: "thr_manager",
    tracker: { kind: "forge-issues" },
    manifestPath: "/work/fleet/manifest.md",
    operator: "ana",
    labels: { spec: "spec", ready: "status:ready", inProgress: "in progress", needsInput: "needs input" },
    marker: "— fleet",
    echoActors: [],
    contract: 1,
    intervalMs: null,
    registeredAt: "2026-10-12T10:00:00.000Z",
    ...over,
  };
};

const row = (key: string, over: Partial<Omit<LedgerRow, "wakeId">> = {}): Omit<LedgerRow, "wakeId"> => ({
  key,
  role: "forge",
  ref: "#1",
  url: "https://github.com/org/repo/pull/1",
  kind: "commented",
  label: null,
  actor: "bob",
  at: "2026-10-12T10:00:00.000Z",
  seenAt: "2026-10-12T10:01:00.000Z",
  disposition: "wake",
  rule: null,
  ...over,
});

const poll = (over: Partial<PollRecord> = {}): PollRecord => ({
  at: "2026-10-12T10:00:00.000Z",
  role: "forge",
  requests: [{ method: "GET", path: "/repos/org/repo/issues", status: 200, counted: true }],
  counted: 1,
  ok: true,
  ...over,
});

const wakeFields = (over: Record<string, unknown> = {}) => ({
  kind: "changes" as const,
  threadId: "thr_manager",
  queuedMessageId: "msg_1" as string | null,
  queuedAt: "2026-10-12T10:00:00.000Z",
  since: "2026-10-12T09:58:00.000Z",
  catchUpMs: null,
  heldSince: null,
  notWatched: null as StoredWake["notWatched"],
  ...over,
});

const cursor = (since: string): SourceCursor => ({
  since,
  items: { "forge:#1": { open: true, merged: false, fleetLabels: ["spec"], inPartition: true } },
});

const pollState = (over: Partial<Parameters<Store["savePollState"]>[1]> = {}): Parameters<Store["savePollState"]>[1] => ({
  lastPolledAt: "2026-10-12T10:02:00.000Z",
  notWatched: [],
  unreadableRows: [],
  outsideLinks: [],
  heldSince: null,
  outages: {},
  pendingCatchUpMs: null,
  ...over,
});

/** A source's outage with its credential refused. */
const refusedOutage = (refused: NonNullable<SourceOutage["refused"]>, unreadablePolls = 0): SourceOutage => ({ unreadablePolls, unreadableSince: unreadablePolls === 0 ? null : refused.since, refused });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Registers a `describe` block running the Store contract over the
 * implementation `make` builds, afresh for every test. `close` releases what
 * the implementation holds.
 */
export function describeStore(name: string, make: () => { store: Store; close?: () => void }): void {
  describe(`${name} (the Store contract)`, () => {
    let store: Store;
    let close: (() => void) | undefined;

    beforeEach(() => {
      const made = make();
      store = made.store;
      close = made.close;
    });
    afterEach(() => close?.());

    describe("registrations", () => {
      it("knows no fleet before one is registered", () => {
        expect(store.getFleet(REPO)).toBeNull();
        expect(store.listFleets()).toEqual([]);
      });

      it("stores a registration under its repository id with the defaults of a fleet never polled", () => {
        const reg = registration("GitHub.com/Org/Repo");
        const notWatched = [{ code: "manifest-missing" as const, text: "No manifest at /work/fleet/manifest.md." }];
        store.saveRegistration(reg, notWatched);

        expect(repoId(reg.repo)).toBe(REPO);
        expect(store.getFleet(REPO)).toEqual<StoredFleet>({
          registration: reg,
          lastPolledAt: null,
          notWatched,
          outages: {},
          pendingCatchUpMs: null,
          unreadableRows: [],
          outsideLinks: [],
          heldSince: null,
        });
        expect(store.getFleet("GitHub.com/Org/Repo")).toBeNull();
      });

      it("lists every fleet", () => {
        store.saveRegistration(registration(OTHER), []);
        store.saveRegistration(registration(REPO), []);
        expect(store.listFleets().map((fleet) => repoId(fleet.registration.repo))).toEqual([REPO, OTHER]);
      });

      it("replaces the registered fields on a second registration and keeps cursors, ledger, wakes and the last poll", () => {
        store.saveRegistration(registration(REPO), [{ code: "no-credential", text: "No credential for github.com/org." }]);
        store.commit({ repo: REPO, at: "2026-10-12T10:05:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-10-12T10:04:00.000Z") }] });
        store.recordChange(REPO, row("k1"));
        store.recordFailedRead(REPO, { at: "2026-10-12T10:05:00.000Z", role: "forge", ref: "#9", reason: "no state" });
        store.recordPoll(REPO, poll());
        const wake = store.createWake(REPO, wakeFields());

        const changed = registration(REPO, {
          managerThreadId: "thr_second",
          labels: { spec: "specification", ready: "ready", inProgress: "wip", needsInput: "question" },
          echoActors: ["fleet-bot"],
        });
        store.saveRegistration(changed, []);

        const fleet = store.getFleet(REPO)!;
        expect(fleet.registration).toEqual(changed);
        expect(fleet.notWatched).toEqual([]);
        expect(fleet.lastPolledAt).toBe("2026-10-12T10:05:00.000Z");
        expect(store.getCursor(REPO, "forge")).toEqual(cursor("2026-10-12T10:04:00.000Z"));
        expect(store.ledger(REPO, {})).toHaveLength(4);
        expect(store.openWake(REPO)).toEqual(wake);
        expect(store.listFleets()).toHaveLength(1);
      });

      it("keeps the poll state a re-registration does not mention", () => {
        store.saveRegistration(registration(), []);
        store.savePollState(
          REPO,
          pollState({
            unreadableRows: [{ section: "In flight", line: 7, reason: "no Stage" }],
            outsideLinks: [{ text: "https://example.net/x", section: "Blocked", line: 9 }],
            heldSince: "2026-10-12T09:00:00.000Z",
            outages: { tracker: refusedOutage({ since: "2026-10-12T09:30:00.000Z", credential: "linear", announced: true, why: "forbidden" }, 3) },
          }),
        );
        store.saveRegistration(registration(REPO, { operator: "carol" }), []);

        const fleet = store.getFleet(REPO)!;
        expect(fleet.registration.operator).toBe("carol");
        expect(fleet.unreadableRows).toHaveLength(1);
        expect(fleet.outsideLinks).toHaveLength(1);
        expect(fleet.heldSince).toBe("2026-10-12T09:00:00.000Z");
        expect(fleet.outages).toEqual({ tracker: refusedOutage({ since: "2026-10-12T09:30:00.000Z", credential: "linear", announced: true, why: "forbidden" }, 3) });
      });

      it("sets and clears a fleet's own interval", () => {
        store.saveRegistration(registration(), []);
        store.setIntervalMs(REPO, 45_000);
        expect(store.getFleet(REPO)!.registration.intervalMs).toBe(45_000);
        store.setIntervalMs(REPO, null);
        expect(store.getFleet(REPO)!.registration.intervalMs).toBeNull();
      });

      it("stores the interval a registration carries", () => {
        store.saveRegistration(registration(REPO, { intervalMs: 60_000 }), []);
        expect(store.getFleet(REPO)!.registration.intervalMs).toBe(60_000);
      });

      it("hands out copies, so changing one does not change the store", () => {
        store.saveRegistration(registration(REPO, { echoActors: ["fleet-bot"] }), [{ code: "no-credential", text: "x" }]);
        const fleet = store.getFleet(REPO)! as unknown as { registration: { echoActors: string[] }; notWatched: unknown[] };
        fleet.registration.echoActors.push("someone");
        fleet.notWatched.length = 0;
        expect(store.getFleet(REPO)!.registration.echoActors).toEqual(["fleet-bot"]);
        expect(store.getFleet(REPO)!.notWatched).toHaveLength(1);
      });

      describe("removing a fleet", () => {
        it("deletes the registration and cursors of that repository, keeps its ledger for retention to age out, and says it existed", () => {
          store.saveRegistration(registration(REPO), []);
          store.commit({ repo: REPO, at: "2026-10-12T10:05:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-10-12T10:04:00.000Z") }, { role: "tracker", cursor: cursor("2026-10-12T10:03:00.000Z") }] });
          store.recordChange(REPO, row("k1"));
          store.recordFailedRead(REPO, { at: "2026-10-12T10:05:00.000Z", role: "forge", ref: null, reason: "listing failed" });
          store.recordPoll(REPO, poll());
          store.createWake(REPO, wakeFields());

          expect(store.removeFleet(REPO)).toBe(true);

          expect(store.getFleet(REPO)).toBeNull();
          expect(store.listFleets()).toEqual([]);
          expect(store.getCursor(REPO, "forge")).toBeNull();
          expect(store.getCursor(REPO, "tracker")).toBeNull();
          expect(store.ledger(REPO, {}).map((entry) => entry.type).sort()).toEqual(["change", "failed read", "poll", "wake"]);
          expect(store.openWake(REPO)).not.toBeNull();
          expect(store.requestsSince(REPO, "2000-01-01T00:00:00.000Z")).toBe(1);
          expect(store.dispositions(REPO, ["k1"]).get("k1")).toBe("wake");
        });

        it("keeps the changes held for no manager, for a registration that follows", () => {
          store.saveRegistration(registration(REPO), []);
          store.recordChange(REPO, row("k1", { disposition: "held", rule: "no manager" }));
          store.removeFleet(REPO);
          expect(store.heldChanges(REPO).map((change) => change.key)).toEqual(["k1"]);
          store.saveRegistration(registration(REPO), []);
          expect(store.getFleet(REPO)).toMatchObject({ lastPolledAt: null, heldSince: null });
          expect(store.getCursor(REPO, "forge")).toBeNull();
        });

        it("lets retention age the kept ledger out", () => {
          store.saveRegistration(registration(REPO), []);
          store.recordChange(REPO, row("k1"));
          store.removeFleet(REPO);
          store.prune("2030-01-01T00:00:00.000Z");
          expect(store.ledger(REPO, {})).toEqual([]);
        });

        it("says so when there was none", () => {
          expect(store.removeFleet(REPO)).toBe(false);
          store.saveRegistration(registration(), []);
          expect(store.removeFleet(REPO)).toBe(true);
          expect(store.removeFleet(REPO)).toBe(false);
        });

        it("leaves other repositories untouched", () => {
          for (const repo of [REPO, OTHER]) {
            store.saveRegistration(registration(repo), []);
            store.commit({ repo, at: "2026-10-12T10:05:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-10-12T10:04:00.000Z") }] });
            store.recordChange(repo, row("k1"));
            store.recordFailedRead(repo, { at: "2026-10-12T10:05:00.000Z", role: "forge", ref: "#2", reason: "no state" });
            store.recordPoll(repo, poll());
            store.createWake(repo, wakeFields({ queuedMessageId: `msg_${repo}` }));
          }
          const before = store.ledger(OTHER, {});

          store.removeFleet(REPO);

          expect(store.getFleet(OTHER)).not.toBeNull();
          expect(store.getCursor(OTHER, "forge")).toEqual(cursor("2026-10-12T10:04:00.000Z"));
          expect(store.ledger(OTHER, {})).toEqual(before);
          expect(before).toHaveLength(4);
          expect(store.openWake(OTHER)?.queuedMessageId).toBe(`msg_${OTHER}`);
          expect(store.requestsSince(OTHER, "2000-01-01T00:00:00.000Z")).toBe(1);
        });
      });
    });

    describe("poll state", () => {
      beforeEach(() => store.saveRegistration(registration(), []));

      it("replaces the fields it is given", () => {
        store.savePollState(
          REPO,
          pollState({
            notWatched: [{ code: "manifest-unreadable", text: "Cannot read /work/fleet/manifest.md." }],
            unreadableRows: [{ section: "Inbox", line: 12, reason: "Waits for is not one of answer, grant, ready, other" }],
            outsideLinks: [{ text: "https://example.net/x", section: "In flight", line: 14 }],
            heldSince: "2026-10-12T09:00:00.000Z",
          }),
        );
        const fleet = store.getFleet(REPO)!;
        expect(fleet.lastPolledAt).toBe("2026-10-12T10:02:00.000Z");
        expect(fleet.notWatched).toEqual([{ code: "manifest-unreadable", text: "Cannot read /work/fleet/manifest.md." }]);
        expect(fleet.unreadableRows).toEqual([{ section: "Inbox", line: 12, reason: "Waits for is not one of answer, grant, ready, other" }]);
        expect(fleet.outsideLinks).toEqual([{ text: "https://example.net/x", section: "In flight", line: 14 }]);
        expect(fleet.heldSince).toBe("2026-10-12T09:00:00.000Z");

        store.savePollState(REPO, pollState({ lastPolledAt: "2026-10-12T10:04:00.000Z" }));
        const cleared = store.getFleet(REPO)!;
        expect(cleared.lastPolledAt).toBe("2026-10-12T10:04:00.000Z");
        expect(cleared.notWatched).toEqual([]);
        expect(cleared.unreadableRows).toEqual([]);
        expect(cleared.outsideLinks).toEqual([]);
        expect(cleared.heldSince).toBeNull();
      });

      it("keeps the registration and the cursors", () => {
        store.commit({ repo: REPO, at: "2026-10-12T10:01:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-10-12T10:00:00.000Z") }] });
        store.savePollState(REPO, pollState());
        expect(store.getFleet(REPO)!.registration).toEqual(registration());
        expect(store.getCursor(REPO, "forge")).toEqual(cursor("2026-10-12T10:00:00.000Z"));
      });

      it("records each source's outage, and an omitted one clears it", () => {
        const forge = refusedOutage({ since: "2026-10-12T09:30:00.000Z", credential: "github.com/org", announced: false, why: "refused" });
        const tracker: SourceOutage = { unreadablePolls: 2, unreadableSince: "2026-10-12T09:40:00.000Z", refused: null };
        store.savePollState(REPO, pollState({ outages: { forge, tracker } }));
        expect(store.getFleet(REPO)!.outages).toEqual({ forge, tracker });

        store.savePollState(REPO, pollState({ outages: { tracker } }));
        expect(store.getFleet(REPO)!.outages).toEqual({ tracker });

        store.savePollState(REPO, pollState());
        expect(store.getFleet(REPO)!.outages).toEqual({});
      });

      it("keeps a source's announced while its refusal is the same one and resets it for another", () => {
        const refused = { since: "2026-10-12T09:30:00.000Z", credential: "github.com/org", announced: false, why: "refused" as const };
        store.savePollState(REPO, pollState({ outages: { forge: refusedOutage(refused) } }));
        store.markRefusedAnnounced(REPO, "forge");
        expect(store.getFleet(REPO)!.outages.forge?.refused?.announced).toBe(true);

        store.savePollState(REPO, pollState({ outages: { forge: refusedOutage(refused) } }));
        expect(store.getFleet(REPO)!.outages.forge?.refused?.announced).toBe(true);

        store.savePollState(REPO, pollState({ outages: { forge: refusedOutage({ ...refused, since: "2026-10-12T11:00:00.000Z" }) } }));
        expect(store.getFleet(REPO)!.outages.forge?.refused).toEqual({ since: "2026-10-12T11:00:00.000Z", credential: "github.com/org", announced: false, why: "refused" });

        store.markRefusedAnnounced(REPO, "forge");
        store.savePollState(REPO, pollState({ outages: { forge: refusedOutage({ since: "2026-10-12T11:00:00.000Z", credential: "github.com", announced: false, why: "refused" }) } }));
        expect(store.getFleet(REPO)!.outages.forge?.refused).toEqual({ since: "2026-10-12T11:00:00.000Z", credential: "github.com", announced: false, why: "refused" });
      });

      it("marks only the source named announced", () => {
        const forge = refusedOutage({ since: "2026-10-12T09:30:00.000Z", credential: "github.com/org", announced: false, why: "forbidden" });
        const tracker = refusedOutage({ since: "2026-10-12T09:40:00.000Z", credential: "linear", announced: false, why: "unreachable" });
        store.savePollState(REPO, pollState({ outages: { forge, tracker } }));
        store.markRefusedAnnounced(REPO, "tracker");
        expect(store.getFleet(REPO)!.outages).toEqual({ forge, tracker: { ...tracker, refused: { ...tracker.refused!, announced: true } } });
      });

      it("records why each credential counts as refused, and the count of unreadable polls and when they began", () => {
        for (const why of ["refused", "forbidden", "unreachable", "not-found", "outside-fleet", "listing-failed"] as const) {
          const outage = refusedOutage({ since: "2026-10-12T09:30:00.000Z", credential: "github.com/org", announced: false, why }, 3);
          store.savePollState(REPO, pollState({ outages: { forge: outage } }));
          expect(store.getFleet(REPO)!.outages.forge).toEqual(outage);
        }
      });

      it("records the catch-up owed to the next wake, and clears it", () => {
        store.savePollState(REPO, pollState({ pendingCatchUpMs: 3_600_000 }));
        expect(store.getFleet(REPO)!.pendingCatchUpMs).toBe(3_600_000);
        store.savePollState(REPO, pollState());
        expect(store.getFleet(REPO)!.pendingCatchUpMs).toBeNull();
      });

      it("marks nothing announced while no credential is refused", () => {
        store.markRefusedAnnounced(REPO, "forge");
        expect(store.getFleet(REPO)!.outages).toEqual({});
        store.savePollState(REPO, pollState({ outages: { forge: { unreadablePolls: 1, unreadableSince: "2026-10-12T09:30:00.000Z", refused: null } } }));
        store.markRefusedAnnounced(REPO, "forge");
        expect(store.getFleet(REPO)!.outages).toEqual({ forge: { unreadablePolls: 1, unreadableSince: "2026-10-12T09:30:00.000Z", refused: null } });
      });
    });

    describe("cursors", () => {
      beforeEach(() => store.saveRegistration(registration(), []));

      it("has none before a commit", () => {
        expect(store.getCursor(REPO, "forge")).toBeNull();
        expect(store.getCursor(REPO, "tracker")).toBeNull();
      });

      it("commits every cursor given and the time of the poll", () => {
        store.commit({
          repo: REPO,
          at: "2026-10-12T10:05:00.000Z",
          cursors: [
            { role: "forge", cursor: cursor("2026-10-12T10:04:00.000Z") },
            { role: "tracker", cursor: cursor("2026-10-12T10:03:00.000Z") },
          ],
        });
        expect(store.getCursor(REPO, "forge")).toEqual(cursor("2026-10-12T10:04:00.000Z"));
        expect(store.getCursor(REPO, "tracker")).toEqual(cursor("2026-10-12T10:03:00.000Z"));
        expect(store.getFleet(REPO)!.lastPolledAt).toBe("2026-10-12T10:05:00.000Z");
      });

      it("replaces a cursor and leaves the one not given", () => {
        store.commit({
          repo: REPO,
          at: "2026-10-12T10:05:00.000Z",
          cursors: [
            { role: "forge", cursor: cursor("2026-10-12T10:04:00.000Z") },
            { role: "tracker", cursor: cursor("2026-10-12T10:03:00.000Z") },
          ],
        });
        store.commit({ repo: REPO, at: "2026-10-12T10:07:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-10-12T10:06:00.000Z") }] });
        expect(store.getCursor(REPO, "forge")).toEqual(cursor("2026-10-12T10:06:00.000Z"));
        expect(store.getCursor(REPO, "tracker")).toEqual(cursor("2026-10-12T10:03:00.000Z"));
        expect(store.getFleet(REPO)!.lastPolledAt).toBe("2026-10-12T10:07:00.000Z");
      });

      it("sets the time of the poll even when no cursor advanced", () => {
        store.commit({ repo: REPO, at: "2026-10-12T10:05:00.000Z", cursors: [] });
        expect(store.getFleet(REPO)!.lastPolledAt).toBe("2026-10-12T10:05:00.000Z");
      });

      it("keeps cursors per repository", () => {
        store.saveRegistration(registration(OTHER), []);
        store.commit({ repo: REPO, at: "2026-10-12T10:05:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-10-12T10:04:00.000Z") }] });
        expect(store.getCursor(OTHER, "forge")).toBeNull();
        expect(store.getFleet(OTHER)!.lastPolledAt).toBeNull();
      });

      it("writes all of a commit or none of it", () => {
        store.commit({ repo: REPO, at: "2026-10-12T10:01:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-10-12T10:00:00.000Z") }] });
        const unwritable = { since: "2026-10-12T10:03:00.000Z", items: {}, toJSON: () => { throw new Error("cannot be written"); } } as unknown as SourceCursor;

        expect(() =>
          store.commit({
            repo: REPO,
            at: "2026-10-12T10:05:00.000Z",
            cursors: [
              { role: "forge", cursor: cursor("2026-10-12T10:04:00.000Z") },
              { role: "tracker", cursor: unwritable },
            ],
          }),
        ).toThrow();

        expect(store.getCursor(REPO, "forge")).toEqual(cursor("2026-10-12T10:00:00.000Z"));
        expect(store.getCursor(REPO, "tracker")).toBeNull();
        expect(store.getFleet(REPO)!.lastPolledAt).toBe("2026-10-12T10:01:00.000Z");
      });
    });

    describe("the ledger's changes", () => {
      beforeEach(() => store.saveRegistration(registration(), []));

      it("records a change once and says what became of each key", () => {
        store.recordChange(REPO, row("a", { disposition: "wake" }));
        store.recordChange(REPO, row("b", { disposition: "echo", rule: "marker" }));
        store.recordChange(REPO, row("c", { disposition: "out-of-scope" }));
        store.recordChange(REPO, row("d", { disposition: "held", rule: "no manager" }));

        expect(store.dispositions(REPO, ["a", "b", "c", "d", "missing"])).toEqual(
          new Map([
            ["a", "wake"],
            ["b", "echo"],
            ["c", "out-of-scope"],
            ["d", "held"],
          ]),
        );
        expect(store.dispositions(REPO, [])).toEqual(new Map());
        expect(store.dispositions(OTHER, ["a"])).toEqual(new Map());
      });

      it("returns the row as recorded, with no wake yet", () => {
        const recorded = row("a", { kind: "labelled", label: "status:ready", actor: null, disposition: "echo", rule: "label" });
        store.recordChange(REPO, recorded);
        expect(store.ledger(REPO, {})).toEqual([{ type: "change", row: { ...recorded, wakeId: null } }]);
      });

      it("changes nothing when the same key is recorded again with the same disposition", () => {
        store.recordChange(REPO, row("a", { disposition: "echo", rule: "marker", seenAt: "2026-10-12T10:01:00.000Z" }));
        store.recordChange(REPO, row("a", { disposition: "echo", rule: "label", seenAt: "2026-10-12T10:09:00.000Z", actor: "someone" }));
        const [entry] = store.ledger(REPO, {});
        expect(entry).toEqual({ type: "change", row: { ...row("a", { disposition: "echo", rule: "marker", seenAt: "2026-10-12T10:01:00.000Z" }), wakeId: null } });
        expect(store.ledger(REPO, {})).toHaveLength(1);
      });

      it("takes the new disposition of a held row, keeping when it was first seen", () => {
        store.recordChange(REPO, row("a", { disposition: "held", rule: "no manager", seenAt: "2026-10-12T10:01:00.000Z" }));
        store.recordChange(REPO, row("a", { disposition: "wake", rule: null, seenAt: "2026-10-12T10:09:00.000Z" }));

        expect(store.dispositions(REPO, ["a"]).get("a")).toBe("wake");
        const entries = store.ledger(REPO, {});
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ type: "change", row: { disposition: "wake", rule: null, seenAt: "2026-10-12T10:01:00.000Z" } });
        expect(store.heldChanges(REPO)).toEqual([]);
      });

      it("leaves a row that is not held as it was", () => {
        store.recordChange(REPO, row("a", { disposition: "wake" }));
        store.recordChange(REPO, row("a", { disposition: "held", rule: "no manager" }));
        store.recordChange(REPO, row("a", { disposition: "echo", rule: "marker" }));
        expect(store.dispositions(REPO, ["a"]).get("a")).toBe("wake");
      });

      it("keeps a key apart in each repository", () => {
        store.saveRegistration(registration(OTHER), []);
        store.recordChange(REPO, row("a", { disposition: "wake" }));
        store.recordChange(OTHER, row("a", { disposition: "echo", rule: "marker" }));
        expect(store.dispositions(REPO, ["a"]).get("a")).toBe("wake");
        expect(store.dispositions(OTHER, ["a"]).get("a")).toBe("echo");
      });

      it("answers for more keys than a statement can bind", () => {
        const keys = Array.from({ length: 1_300 }, (_, at) => `key-${at}`);
        for (const key of keys.slice(0, 1_200)) store.recordChange(REPO, row(key, { disposition: "out-of-scope" }));
        const found = store.dispositions(REPO, keys);
        expect(found.size).toBe(1_200);
        expect(found.get("key-1199")).toBe("out-of-scope");
        expect(found.has("key-1200")).toBe(false);
        store.markWoke(REPO, 1, keys);
        expect(store.wakeChanges(REPO, 1)).toHaveLength(1_200);
      });

      describe("held changes", () => {
        it("lists the held rows as changes, oldest first, with no text from the service", () => {
          store.recordChange(REPO, row("b", { kind: "reviewed: approved", at: "2026-10-12T10:20:00.000Z", disposition: "held", rule: "no manager", ref: "#2", url: "https://github.com/org/repo/pull/2" }));
          store.recordChange(REPO, row("a", { kind: "labelled", label: "status:ready", role: "tracker", at: "2026-10-12T10:10:00.000Z", actor: null, disposition: "held", rule: "no manager" }));
          store.recordChange(REPO, row("c", { at: "2026-10-12T10:05:00.000Z", disposition: "wake" }));
          store.recordChange(REPO, row("d", { at: "2026-10-12T10:30:00.000Z", disposition: "echo", rule: "marker" }));

          expect(store.heldChanges(REPO)).toEqual([
            { key: "a", role: "tracker", ref: "#1", url: "https://github.com/org/repo/pull/1", kind: "labelled", label: "status:ready", actor: null, at: "2026-10-12T10:10:00.000Z", lastLine: null },
            { key: "b", role: "forge", ref: "#2", url: "https://github.com/org/repo/pull/2", kind: "reviewed: approved", label: null, actor: "bob", at: "2026-10-12T10:20:00.000Z", lastLine: null },
          ]);
        });

        it("breaks a tie on time by key and keeps repositories apart", () => {
          store.saveRegistration(registration(OTHER), []);
          store.recordChange(REPO, row("z", { disposition: "held", rule: "no manager" }));
          store.recordChange(REPO, row("y", { disposition: "held", rule: "no manager" }));
          store.recordChange(OTHER, row("x", { disposition: "held", rule: "no manager" }));
          expect(store.heldChanges(REPO).map((change) => change.key)).toEqual(["y", "z"]);
          expect(store.heldChanges(OTHER).map((change) => change.key)).toEqual(["x"]);
        });
      });

      describe("marking changes woke", () => {
        it("sets the disposition and the wake of the rows named, and returns them ordered by time then key", () => {
          store.recordChange(REPO, row("c", { at: "2026-10-12T10:03:00.000Z" }));
          store.recordChange(REPO, row("b", { at: "2026-10-12T10:01:00.000Z" }));
          store.recordChange(REPO, row("a", { at: "2026-10-12T10:01:00.000Z" }));
          store.recordChange(REPO, row("d", { at: "2026-10-12T10:02:00.000Z" }));
          store.recordChange(REPO, row("e", { at: "2026-10-12T10:00:00.000Z", disposition: "echo", rule: "marker" }));
          const wake = store.createWake(REPO, wakeFields());
          const other = store.createWake(REPO, wakeFields({ queuedMessageId: "msg_2" }));

          store.markWoke(REPO, wake.id, ["c", "b", "a"]);
          store.markWoke(REPO, other.id, ["d"]);

          expect(store.wakeChanges(REPO, wake.id).map((change) => change.key)).toEqual(["a", "b", "c"]);
          expect(store.wakeChanges(REPO, other.id).map((change) => change.key)).toEqual(["d"]);
          expect(store.wakeChanges(REPO, wake.id + 100)).toEqual([]);
          expect(store.wakeChanges(REPO, wake.id)[0]).toEqual({ key: "a", role: "forge", ref: "#1", url: "https://github.com/org/repo/pull/1", kind: "commented", label: null, actor: "bob", at: "2026-10-12T10:01:00.000Z", lastLine: null });
          expect(store.ledger(REPO, { done: "woke" })).toHaveLength(4);
          expect(store.ledger(REPO, {}).filter((entry) => entry.type === "change" && entry.row.wakeId === wake.id)).toHaveLength(3);
        });

        it("turns a held row into a woke one", () => {
          store.recordChange(REPO, row("a", { disposition: "held", rule: "no manager" }));
          const wake = store.createWake(REPO, wakeFields());
          store.recordChange(REPO, row("a", { disposition: "wake" }));
          store.markWoke(REPO, wake.id, ["a"]);
          expect(store.heldChanges(REPO)).toEqual([]);
          expect(store.wakeChanges(REPO, wake.id).map((change) => change.key)).toEqual(["a"]);
        });

        it("does not touch another repository's rows", () => {
          store.saveRegistration(registration(OTHER), []);
          store.recordChange(REPO, row("a"));
          store.recordChange(OTHER, row("a"));
          const wake = store.createWake(REPO, wakeFields());
          store.markWoke(REPO, wake.id, ["a"]);
          expect(store.wakeChanges(OTHER, wake.id)).toEqual([]);
        });
      });
    });

    describe("polls and failed reads", () => {
      beforeEach(() => store.saveRegistration(registration(), []));

      it("sums the counted requests of the polls at or after a time", () => {
        store.recordPoll(REPO, poll({ at: "2026-10-12T09:00:00.000Z", counted: 5 }));
        store.recordPoll(REPO, poll({ at: "2026-10-12T10:00:00.000Z", counted: 3 }));
        store.recordPoll(REPO, poll({ at: "2026-10-12T10:00:00.000Z", role: "tracker", counted: 2 }));
        store.recordPoll(REPO, poll({ at: "2026-10-12T11:00:00.000Z", counted: 7, ok: false }));

        expect(store.requestsSince(REPO, "2026-10-12T10:00:00.000Z")).toBe(12);
        expect(store.requestsSince(REPO, "2026-10-12T10:00:00.001Z")).toBe(7);
        expect(store.requestsSince(REPO, "2026-10-12T00:00:00.000Z")).toBe(17);
        expect(store.requestsSince(REPO, "2026-10-12T12:00:00.000Z")).toBe(0);
      });

      it("counts only the repository asked about", () => {
        store.saveRegistration(registration(OTHER), []);
        store.recordPoll(REPO, poll({ counted: 4 }));
        store.recordPoll(OTHER, poll({ counted: 9 }));
        expect(store.requestsSince(REPO, "2026-10-12T00:00:00.000Z")).toBe(4);
        expect(store.requestsSince(OTHER, "2026-10-12T00:00:00.000Z")).toBe(9);
      });

      it("returns a poll with its requests", () => {
        const recorded = poll({
          requests: [
            { method: "GET", path: "/repos/org/repo/issues", status: 200, counted: true },
            { method: "GET", path: "/repos/org/repo/issues/1", status: 304, counted: false },
            { method: "GET", path: "/repos/org/repo/pulls", status: null, counted: true },
          ],
          counted: 2,
          ok: false,
        });
        store.recordPoll(REPO, recorded);
        expect(store.ledger(REPO, {})).toEqual([{ type: "poll", poll: recorded }]);
      });

      it("returns a failed read, with or without an item", () => {
        store.recordFailedRead(REPO, { at: "2026-10-12T10:00:00.000Z", role: "forge", ref: "#9", reason: "state missing" });
        store.recordFailedRead(REPO, { at: "2026-10-12T10:01:00.000Z", role: "tracker", ref: null, reason: "listing returned 500" });
        expect(store.ledger(REPO, {})).toEqual([
          { type: "failed read", at: "2026-10-12T10:01:00.000Z", role: "tracker", ref: null, reason: "listing returned 500" },
          { type: "failed read", at: "2026-10-12T10:00:00.000Z", role: "forge", ref: "#9", reason: "state missing" },
        ]);
      });
    });

    describe("wakes", () => {
      beforeEach(() => {
        store.saveRegistration(registration(), []);
        store.saveRegistration(registration(OTHER), []);
      });

      it("stores a wake with an id that no other wake in any repository has, and no dispatch time", () => {
        const first = store.createWake(REPO, wakeFields({ catchUpMs: 3_600_000, heldSince: "2026-10-12T08:00:00.000Z" }));
        const second = store.createWake(OTHER, wakeFields({ queuedMessageId: "msg_2" }));
        const third = store.createWake(REPO, wakeFields({ queuedMessageId: "msg_3" }));

        expect(first).toEqual({
          id: first.id,
          repo: REPO,
          kind: "changes",
          threadId: "thr_manager",
          queuedMessageId: "msg_1",
          queuedAt: "2026-10-12T10:00:00.000Z",
          dispatchedAt: null,
          since: "2026-10-12T09:58:00.000Z",
          catchUpMs: 3_600_000,
          heldSince: "2026-10-12T08:00:00.000Z",
          notWatched: null,
        });
        expect(new Set([first.id, second.id, third.id]).size).toBe(3);
        expect(second.id).toBeGreaterThan(first.id);
        expect(third.id).toBeGreaterThan(second.id);
        expect(second.repo).toBe(OTHER);
      });

      it("keeps a dispatch time the wake is created with", () => {
        const sent = store.createWake(REPO, wakeFields({ queuedMessageId: null, dispatchedAt: "2026-10-12T10:00:01.000Z" }));
        expect(sent.dispatchedAt).toBe("2026-10-12T10:00:01.000Z");
        expect(store.ledger(REPO, {})).toEqual([{ type: "wake", wake: sent }]);
      });

      it("does not hand out the id of a wake pruned or removed", () => {
        const first = store.createWake(REPO, wakeFields());
        store.removeFleet(REPO);
        const second = store.createWake(OTHER, wakeFields());
        expect(second.id).toBeGreaterThan(first.id);
      });

      describe("the open wake", () => {
        it("is the latest wake of either kind that waits in bb's queue", () => {
          expect(store.openWake(REPO)).toBeNull();
          const first = store.createWake(REPO, wakeFields({ queuedMessageId: "msg_1" }));
          expect(store.openWake(REPO)).toEqual(first);
          const second = store.createWake(REPO, wakeFields({ queuedMessageId: "msg_2" }));
          expect(store.openWake(REPO)).toEqual(second);
          expect(store.openWake(OTHER)).toBeNull();
        });

        it("is none once dispatched", () => {
          const wake = store.createWake(REPO, wakeFields());
          store.markDispatched("msg_1", "2026-10-12T10:05:00.000Z");
          expect(store.openWake(REPO)).toBeNull();
          expect(store.ledger(REPO, {})).toEqual([{ type: "wake", wake: { ...wake, dispatchedAt: "2026-10-12T10:05:00.000Z" } }]);
        });

        it("skips a wake without a queued message and a dispatched one", () => {
          const waiting = store.createWake(REPO, wakeFields({ queuedMessageId: "msg_1" }));
          store.createWake(REPO, wakeFields({ queuedMessageId: null, dispatchedAt: "2026-10-12T10:00:01.000Z" }));
          store.createWake(REPO, wakeFields({ queuedMessageId: "msg_2", dispatchedAt: "2026-10-12T10:00:02.000Z" }));
          expect(store.openWake(REPO)).toEqual(waiting);
        });

        it("returns a queued not-watched wake, with the line it carries", () => {
          const line = { since: "2026-10-12T09:00:00.000Z", credential: "github.com/org", why: "unreachable" as const };
          const wake = store.createWake(REPO, wakeFields({ kind: "not-watched", queuedMessageId: "msg_nw", notWatched: line }));
          expect(wake.notWatched).toEqual(line);
          expect(store.openWake(REPO)).toEqual(wake);
          expect(store.ledger(REPO, {})).toEqual([{ type: "wake", wake }]);
        });

        it("follows the queued message set on the wake", () => {
          const wake = store.createWake(REPO, wakeFields({ queuedMessageId: null }));
          expect(store.openWake(REPO)).toBeNull();
          store.setWakeQueuedMessage(REPO, wake.id, "msg_9");
          expect(store.openWake(REPO)).toEqual({ ...wake, queuedMessageId: "msg_9" });
          store.setWakeQueuedMessage(REPO, wake.id, null);
          expect(store.openWake(REPO)).toBeNull();
        });

        it("records what an amendment made of the wake", () => {
          const wake = store.createWake(REPO, wakeFields({ kind: "not-watched" }));
          const line = { since: "2026-10-12T09:00:00.000Z", credential: "github.com/org", why: "unreachable" as const };
          store.updateWake(REPO, wake.id, { kind: "changes", catchUpMs: 3_600_000, heldSince: "2026-10-12T08:00:00.000Z", notWatched: line });
          expect(store.openWake(REPO)).toEqual({ ...wake, kind: "changes", catchUpMs: 3_600_000, heldSince: "2026-10-12T08:00:00.000Z", notWatched: line });
          store.updateWake(OTHER, wake.id, { kind: "not-watched", catchUpMs: null, heldSince: null, notWatched: null });
          expect(store.openWake(REPO)).toMatchObject({ kind: "changes", notWatched: line });
        });

        it("is not changed by setting a message on a wake of another repository", () => {
          const wake = store.createWake(REPO, wakeFields({ queuedMessageId: null }));
          store.setWakeQueuedMessage(OTHER, wake.id, "msg_9");
          expect(store.openWake(REPO)).toBeNull();
        });
      });

      it("marks the wake holding a queued message dispatched, in whichever repository it is", () => {
        store.createWake(REPO, wakeFields({ queuedMessageId: "msg_1" }));
        const other = store.createWake(OTHER, wakeFields({ queuedMessageId: "msg_2" }));
        store.markDispatched("msg_2", "2026-10-12T10:05:00.000Z");
        expect(store.openWake(OTHER)).toBeNull();
        expect(store.openWake(REPO)).not.toBeNull();
        expect(store.ledger(OTHER, {})).toEqual([{ type: "wake", wake: { ...other, dispatchedAt: "2026-10-12T10:05:00.000Z" } }]);
        expect(() => store.markDispatched("unknown", "2026-10-12T10:05:00.000Z")).not.toThrow();
      });
    });

    describe("reading the ledger", () => {
      beforeEach(() => store.saveRegistration(registration(), []));

      const fill = () => {
        store.recordChange(REPO, row("woke-1", { ref: "#1", url: "https://github.com/org/repo/pull/1", seenAt: "2026-10-12T10:01:00.000Z", disposition: "wake" }));
        store.recordChange(REPO, row("echo-1", { ref: "#2", url: "https://github.com/org/repo/issues/2", seenAt: "2026-10-12T10:02:00.000Z", disposition: "echo", rule: "marker" }));
        store.recordChange(REPO, row("out-1", { ref: "#3", url: "https://github.com/org/repo/issues/3", kind: "updated", seenAt: "2026-10-12T10:03:00.000Z", disposition: "out-of-scope" }));
        store.recordChange(REPO, row("held-1", { ref: "ENG-4", role: "tracker", url: "https://linear.app/t/issue/ENG-4/x", seenAt: "2026-10-12T10:04:00.000Z", disposition: "held", rule: "no manager" }));
        store.recordFailedRead(REPO, { at: "2026-10-12T10:05:00.000Z", role: "forge", ref: "#1", reason: "state missing" });
        store.createWake(REPO, wakeFields({ queuedAt: "2026-10-12T10:06:00.000Z" }));
        store.recordPoll(REPO, poll({ at: "2026-10-12T10:07:00.000Z" }));
      };

      const kinds = (query: Parameters<Store["ledger"]>[1]) =>
        store.ledger(REPO, query).map((entry) => (entry.type === "change" ? entry.row.key : entry.type));

      it("is empty for a repository with nothing recorded", () => {
        expect(store.ledger(REPO, {})).toEqual([]);
        expect(store.ledger("github.com/nobody/nothing", {})).toEqual([]);
      });

      it("returns everything, newest first by the time each entry happened or was seen", () => {
        fill();
        expect(kinds({})).toEqual(["poll", "wake", "failed read", "held-1", "out-1", "echo-1", "woke-1"]);
      });

      it("orders changes by when they were seen, not by when they happened", () => {
        store.recordChange(REPO, row("late-seen", { at: "2026-10-12T08:00:00.000Z", seenAt: "2026-10-12T10:30:00.000Z" }));
        store.recordChange(REPO, row("early-seen", { at: "2026-10-12T09:00:00.000Z", seenAt: "2026-10-12T10:10:00.000Z" }));
        expect(kinds({})).toEqual(["late-seen", "early-seen"]);
      });

      it("puts what was recorded last first among entries of one time", () => {
        for (const key of ["a", "b", "c"]) store.recordChange(REPO, row(key, { seenAt: "2026-10-12T10:00:00.000Z" }));
        expect(kinds({})).toEqual(["c", "b", "a"]);
      });

      it("returns at most 200 entries unless asked for fewer or more", () => {
        for (let at = 0; at < 205; at += 1) store.recordChange(REPO, row(`k${String(at).padStart(3, "0")}`, { seenAt: new Date(Date.UTC(2026, 9, 12, 10, 0, at)).toISOString() }));
        expect(store.ledger(REPO, {})).toHaveLength(200);
        expect(kinds({ limit: 2 })).toEqual(["k204", "k203"]);
        expect(store.ledger(REPO, { limit: 500 })).toHaveLength(205);
        expect(store.ledger(REPO, { limit: 0 })).toEqual([]);
      });

      it("caps the entries of all types together, keeping the newest", () => {
        fill();
        expect(kinds({ limit: 3 })).toEqual(["poll", "wake", "failed read"]);
      });

      it("keeps the repositories apart", () => {
        store.saveRegistration(registration(OTHER), []);
        fill();
        store.recordChange(OTHER, row("other-1"));
        expect(kinds({})).not.toContain("other-1");
        expect(store.ledger(OTHER, {})).toHaveLength(1);
      });

      describe("filtered by item", () => {
        beforeEach(fill);

        it("matches a reference case-insensitively", () => {
          expect(kinds({ item: "eng-4" })).toEqual(["held-1"]);
          expect(kinds({ item: "ENG-4" })).toEqual(["held-1"]);
          expect(kinds({ item: "#2" })).toEqual(["echo-1"]);
        });

        it("matches a URL exactly", () => {
          expect(kinds({ item: "https://github.com/org/repo/issues/3" })).toEqual(["out-1"]);
          expect(kinds({ item: "https://github.com/org/repo/ISSUES/3" })).toEqual([]);
          expect(kinds({ item: "https://github.com/org/repo/issues" })).toEqual([]);
        });

        it("includes the failed reads of the item and drops wakes and polls", () => {
          expect(kinds({ item: "#1" })).toEqual(["failed read", "woke-1"]);
        });

        it("finds nothing for an item never seen", () => {
          expect(kinds({ item: "#999" })).toEqual([]);
        });
      });

      describe("filtered by what was done", () => {
        beforeEach(fill);

        it.each([
          ["woke", ["woke-1"]],
          ["echo", ["echo-1"]],
          ["out-of-scope", ["out-1"]],
          ["held", ["held-1"]],
        ] as const)("`%s` gives the change rows with that disposition and nothing else", (done, expected) => {
          expect(kinds({ done })).toEqual(expected);
        });

        it("gives the failed reads for `failed read`", () => {
          expect(store.ledger(REPO, { done: "failed read" })).toEqual([
            { type: "failed read", at: "2026-10-12T10:05:00.000Z", role: "forge", ref: "#1", reason: "state missing" },
          ]);
        });

        it("combines with an item", () => {
          expect(kinds({ done: "woke", item: "#1" })).toEqual(["woke-1"]);
          expect(kinds({ done: "echo", item: "#1" })).toEqual([]);
          expect(kinds({ done: "failed read", item: "#1" })).toEqual(["failed read"]);
          expect(kinds({ done: "failed read", item: "#2" })).toEqual([]);
        });

        it("follows a row that changed disposition", () => {
          store.recordChange(REPO, row("held-1", { disposition: "wake" }));
          expect(kinds({ done: "held" })).toEqual([]);
          expect(kinds({ done: "woke" })).toEqual(["held-1", "woke-1"]);
        });
      });
    });

    describe("pruning", () => {
      beforeEach(() => {
        store.saveRegistration(registration(), []);
        store.saveRegistration(registration(OTHER), []);
      });

      it("deletes what is older than the cutoff and keeps the rest, in every repository", () => {
        const before = "2026-10-12T10:00:00.000Z";
        for (const repo of [REPO, OTHER]) {
          store.recordChange(repo, row("old", { seenAt: "2026-10-12T09:59:59.999Z" }));
          store.recordChange(repo, row("edge", { seenAt: before }));
          store.recordChange(repo, row("new", { seenAt: "2026-10-12T10:00:00.001Z" }));
          store.recordFailedRead(repo, { at: "2026-10-12T09:00:00.000Z", role: "forge", ref: "#1", reason: "old" });
          store.recordFailedRead(repo, { at: before, role: "forge", ref: "#1", reason: "edge" });
          store.recordPoll(repo, poll({ at: "2026-10-12T09:00:00.000Z", counted: 10 }));
          store.recordPoll(repo, poll({ at: before, counted: 1 }));
          store.createWake(repo, wakeFields({ queuedAt: "2026-10-12T09:00:00.000Z", queuedMessageId: `old-${repo}` }));
          store.createWake(repo, wakeFields({ queuedAt: before, queuedMessageId: `edge-${repo}` }));
        }

        store.prune(before);

        for (const repo of [REPO, OTHER]) {
          const entries = store.ledger(repo, {});
          expect(entries.filter((entry) => entry.type === "change").map((entry) => entry.type === "change" && entry.row.key).sort()).toEqual(["edge", "new"]);
          expect(entries.filter((entry) => entry.type === "failed read")).toHaveLength(1);
          expect(entries.filter((entry) => entry.type === "poll")).toHaveLength(1);
          expect(entries.filter((entry) => entry.type === "wake")).toHaveLength(1);
          expect(store.requestsSince(repo, "2000-01-01T00:00:00.000Z")).toBe(1);
          expect(store.dispositions(repo, ["old", "edge", "new"]).has("old")).toBe(false);
        }
      });

      it("keeps registrations and cursors", () => {
        store.commit({ repo: REPO, at: "2026-09-01T00:00:00.000Z", cursors: [{ role: "forge", cursor: cursor("2026-09-01T00:00:00.000Z") }] });
        store.prune("2026-10-12T00:00:00.000Z");
        expect(store.getFleet(REPO)!.lastPolledAt).toBe("2026-09-01T00:00:00.000Z");
        expect(store.getCursor(REPO, "forge")).toEqual(cursor("2026-09-01T00:00:00.000Z"));
        expect(store.listFleets()).toHaveLength(2);
      });

      it("keeps thirty days of the ledger when the cutoff is thirty days back", () => {
        const now = Date.UTC(2026, 9, 12, 12, 0, 0);
        const cutoff = new Date(now - 30 * DAY_MS).toISOString();
        const seen = (days: number) => new Date(now - days * DAY_MS).toISOString();
        store.recordChange(REPO, row("day-31", { seenAt: seen(31) }));
        store.recordChange(REPO, row("day-30", { seenAt: seen(30) }));
        store.recordChange(REPO, row("day-29", { seenAt: seen(29) }));
        store.recordChange(REPO, row("today", { seenAt: seen(0) }));
        store.recordPoll(REPO, poll({ at: seen(31), counted: 100 }));
        store.recordPoll(REPO, poll({ at: seen(1), counted: 2 }));

        store.prune(cutoff);

        expect(store.dispositions(REPO, ["day-31", "day-30", "day-29", "today"])).toEqual(
          new Map([
            ["day-30", "wake"],
            ["day-29", "wake"],
            ["today", "wake"],
          ]),
        );
        expect(store.requestsSince(REPO, seen(40))).toBe(2);
      });

      it("leaves the open wake of a repository whose wake is recent", () => {
        const wake = store.createWake(REPO, wakeFields({ queuedAt: "2026-10-12T10:00:00.000Z" }));
        store.prune("2026-10-12T09:00:00.000Z");
        expect(store.openWake(REPO)).toEqual(wake);
      });
    });

    describe("actions the dashboard sent", () => {
      const action = (id: string, over: Partial<ActionRecord> = {}): ActionRecord => ({
        id,
        repo: REPO,
        rowId: `row-${id}`,
        kind: "answer",
        ref: "#163",
        what: "Which cache?",
        managerThreadId: "thr_manager",
        state: "sent",
        sentAt: "2026-10-12T10:00:00.000Z",
        doneAt: null,
        ...over,
      });

      beforeEach(() => {
        store.saveRegistration(registration(), []);
        store.saveRegistration(registration(OTHER), []);
      });

      it("keeps a sent action, oldest first, per repository", () => {
        store.saveAction(action("b", { sentAt: "2026-10-12T10:05:00.000Z" }));
        store.saveAction(action("a"));
        store.saveAction(action("c", { repo: OTHER }));
        expect(store.actions(REPO).map((a) => a.id)).toEqual(["a", "b"]);
        expect(store.actions(OTHER).map((a) => a.id)).toEqual(["c"]);
        expect(store.actions("github.com/none/none")).toEqual([]);
      });

      it("marks sent actions done once, with the time of the poll that saw the result", () => {
        store.saveAction(action("a"));
        store.saveAction(action("b"));
        store.markActionsDone(REPO, ["a"], "2026-10-12T10:10:00.000Z");
        store.markActionsDone(REPO, ["a", "b"], "2026-10-12T10:20:00.000Z");
        expect(store.actions(REPO).map((a) => [a.id, a.state, a.doneAt])).toEqual([
          ["a", "done", "2026-10-12T10:10:00.000Z"],
          ["b", "done", "2026-10-12T10:20:00.000Z"],
        ]);
      });

      it("drops the sent actions of a repository and keeps the done ones", () => {
        store.saveAction(action("a"));
        store.saveAction(action("b", { state: "done", doneAt: "2026-10-12T10:10:00.000Z" }));
        store.saveAction(action("c", { repo: OTHER }));
        store.dropSentActions(REPO);
        expect(store.actions(REPO).map((a) => a.id)).toEqual(["b"]);
        expect(store.actions(OTHER).map((a) => a.id)).toEqual(["c"]);
      });

      it("deletes the actions of a repository when its fleet is removed", () => {
        store.saveAction(action("a"));
        store.removeFleet(REPO);
        expect(store.actions(REPO)).toEqual([]);
      });

      it("prunes done actions older than the cutoff, keeps sent ones however old, and drops those of no fleet", () => {
        store.saveAction(action("old-done", { state: "done", doneAt: "2026-10-10T10:00:00.000Z" }));
        store.saveAction(action("new-done", { state: "done", doneAt: "2026-10-12T09:30:00.000Z" }));
        store.saveAction(action("old-sent", { sentAt: "2026-09-01T10:00:00.000Z" }));
        store.saveAction(action("orphan", { repo: "github.com/gone/gone" }));
        store.pruneActions("2026-10-11T10:00:00.000Z");
        expect(store.actions(REPO).map((a) => a.id)).toEqual(["old-sent", "new-done"]);
        expect(store.actions("github.com/gone/gone")).toEqual([]);
      });
    });

    describe("Inbox rows seen", () => {
      beforeEach(() => {
        store.saveRegistration(registration(), []);
      });

      it("records rows per repository and keeps them", () => {
        store.touchInboxSeen(REPO, ["a", "b"], "2026-10-12T10:00:00.000Z");
        store.touchInboxSeen(OTHER, ["c"], "2026-10-12T10:00:00.000Z");
        expect([...store.inboxSeen(REPO)].sort()).toEqual(["a", "b"]);
        expect([...store.inboxSeen(OTHER)]).toEqual(["c"]);
      });

      it("survives the removal of the fleet, so a re-registration finds the rows", () => {
        store.touchInboxSeen(REPO, ["a"], "2026-10-12T10:00:00.000Z");
        store.removeFleet(REPO);
        expect([...store.inboxSeen(REPO)]).toEqual(["a"]);
      });

      it("moves the time of a row seen again, so pruning forgets only rows gone from the manifest", () => {
        store.touchInboxSeen(REPO, ["old", "kept"], "2026-08-01T00:00:00.000Z");
        store.touchInboxSeen(REPO, ["kept"], "2026-10-12T00:00:00.000Z");
        store.prune("2026-09-12T00:00:00.000Z");
        expect([...store.inboxSeen(REPO)]).toEqual(["kept"]);
      });

      it("knows a repository has been baselined only once it was, and forgets it with the fleet", () => {
        expect(store.inboxBaselined(REPO)).toBe(false);
        store.setInboxBaselined(REPO);
        expect(store.inboxBaselined(REPO)).toBe(true);
        expect(store.inboxBaselined(OTHER)).toBe(false);
        store.saveRegistration(registration(), []);
        expect(store.inboxBaselined(REPO)).toBe(true);
        store.removeFleet(REPO);
        expect(store.inboxBaselined(REPO)).toBe(false);
      });

      it("baselines nothing for a repository no fleet holds", () => {
        store.setInboxBaselined("github.com/none/none");
        expect(store.inboxBaselined("github.com/none/none")).toBe(false);
      });
    });

    describe("recent wakes", () => {
      it("returns the latest wakes of a repository, newest first, up to the limit", () => {
        store.createWake(REPO, wakeFields({ queuedMessageId: "m1", queuedAt: "2026-10-12T10:00:00.000Z" }));
        store.createWake(REPO, wakeFields({ queuedMessageId: "m2", queuedAt: "2026-10-12T10:02:00.000Z" }));
        store.createWake(OTHER, wakeFields({ queuedMessageId: "m3", queuedAt: "2026-10-12T10:03:00.000Z" }));
        store.createWake(REPO, wakeFields({ queuedMessageId: "m4", queuedAt: "2026-10-12T10:01:00.000Z" }));
        expect(store.recentWakes(REPO, 2).map((w) => w.queuedMessageId)).toEqual(["m2", "m4"]);
        expect(store.recentWakes(REPO, 0)).toEqual([]);
      });
    });
  });
}
