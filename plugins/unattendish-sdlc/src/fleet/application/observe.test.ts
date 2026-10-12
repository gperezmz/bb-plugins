// What a read of the manifest shows: Inbox rows new to the repository (AC6) and the actions it shows done (AC13).
import { describe, expect, it } from "vitest";
import { actionId, type ActionRecord } from "../domain/actions";
import { args, event, inboxRow, manifest, MANAGER, MANIFEST_PATH, outcome, REPO_KEY, snapshot, world, type World } from "../testing/kit";
import { pollFleet } from "./poll";
import { registerFleet } from "./register";

const start = async (w: World, text: string | undefined, over = {}) => {
  if (text !== undefined) w.manifests.files.set(MANIFEST_PATH, text);
  await registerFleet(w.register, MANAGER, args(over));
};
const poll = (w: World, options = {}) => pollFleet(w.poll, REPO_KEY, options);
const rowIds = (w: World): string[] => w.events.inboxNews.map((signal) => signal.rowId);
const ROW_7 = "#7|answer|2026-10-12T09:00:00Z";

describe("Inbox rows new to the repository (AC6)", () => {
  it("announces nothing for the rows of a manifest that was there when the fleet registered, and each row added after once", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    await poll(w);
    expect(w.events.inboxNews).toEqual([]);

    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7), inboxRow(8, "grant")] }));
    w.clock.advance(120_000);
    await poll(w);
    expect(w.events.inboxNews).toEqual([{ fleet: "github.com/org/repo", ref: "#8", what: "A parked question", rowId: "#8|grant|2026-10-12T09:00:00Z" }]);

    w.clock.advance(120_000);
    await poll(w);
    expect(w.events.inboxNews).toHaveLength(1);
  });

  it("announces the first rows the manager writes when the manifest was missing at registration", async () => {
    const w = world();
    await start(w, undefined);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7)] }));
    await poll(w);
    expect(rowIds(w)).toEqual([ROW_7]);
  });

  it("announces a row at the manager's turn ending as well as at a poll", async () => {
    const w = world();
    await start(w, manifest());
    await poll(w);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7)] }));
    await poll(w, { stateOnly: true });
    expect(rowIds(w)).toEqual([ROW_7]);
    await poll(w);
    expect(rowIds(w)).toEqual([ROW_7]);
  });

  it("does not announce a row that returns with the id it had, and announces one with another id", async () => {
    const w = world();
    await start(w, manifest());
    await poll(w);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7)] }));
    await poll(w);
    w.manifests.files.set(MANIFEST_PATH, manifest());
    await poll(w);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7)] }));
    await poll(w);
    expect(rowIds(w)).toEqual([ROW_7]);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7).replace("09:00:00Z", "11:00:00Z")] }));
    await poll(w);
    expect(rowIds(w)).toEqual([ROW_7, "#7|answer|2026-10-12T11:00:00Z"]);
  });

  it("announces nothing for a row the plugin cannot read", async () => {
    const w = world();
    await start(w, manifest());
    await poll(w);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: ["| nope | A parked question | answer | 2026-10-12T09:00:00Z | https://github.com/org/repo/issues/7 |"] }));
    await poll(w);
    expect(w.events.inboxNews).toEqual([]);
  });

  it("announces nothing at a restart, a re-registration or a takeover for rows already there, and keeps the rows after the fleet is unregistered", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    await poll(w);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7), inboxRow(8)] }));
    await registerFleet(w.register, MANAGER, args());
    w.threads.states.set(MANAGER, "archived");
    w.threads.states.set("thr_second", "live");
    await registerFleet(w.register, "thr_second", args());
    await poll(w);
    expect(w.events.inboxNews).toEqual([]);

    w.store.removeFleet(REPO_KEY);
    await registerFleet(w.register, "thr_second", args());
    await poll(w);
    expect(w.events.inboxNews).toEqual([]);
  });

  it("only records the rows of a fleet stored before they were recorded, at its first read", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    // A fleet from before this feature: registered, never baselined, nothing recorded.
    const stored = w.store.getFleet(REPO_KEY)!;
    w.store.removeFleet(REPO_KEY);
    w.store.saveRegistration(stored.registration, []);
    await poll(w);
    expect(w.events.inboxNews).toEqual([]);
    expect([...w.store.inboxSeen(REPO_KEY)]).toEqual([ROW_7]);
  });

  it("baselines at the first read that can be made when the manifest was unreadable at registration", async () => {
    const w = world();
    await start(w, "not a manifest");
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7)] }));
    await poll(w);
    expect(w.events.inboxNews).toEqual([]);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(7), inboxRow(8)] }));
    await poll(w);
    expect(rowIds(w)).toEqual(["#8|answer|2026-10-12T09:00:00Z"]);
  });

  it("tells the windows the board changed after each poll that ran, a registration, and a takeover", async () => {
    const w = world();
    await start(w, manifest());
    expect(w.events.boardChanges).toBe(1);
    await poll(w);
    await poll(w, { stateOnly: true });
    expect(w.events.boardChanges).toBe(3);
    w.store.removeFleet(REPO_KEY);
    await poll(w);
    expect(w.events.boardChanges).toBe(3);
  });
});

const sentAction = (w: World, over: Partial<ActionRecord> = {}): ActionRecord => {
  const record: ActionRecord = {
    id: actionId(ROW_7, "2026-10-12T09:59:00.000Z"),
    repo: REPO_KEY,
    rowId: ROW_7,
    kind: "answer",
    ref: "#7",
    what: "A parked question",
    managerThreadId: MANAGER,
    state: "sent",
    sentAt: "2026-10-12T09:59:00.000Z",
    doneAt: null,
    ...over,
  };
  w.store.saveAction(record);
  return record;
};

describe("an action is done once a poll sees its result (AC13)", () => {
  it("keeps an answer sent while its row is still in the Inbox, however many polls, and marks it done at the poll that finds the row gone", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    const record = sentAction(w);
    for (let n = 0; n < 4; n += 1) {
      w.clock.advance(120_000);
      await poll(w);
    }
    expect(w.store.actions(REPO_KEY)).toEqual([record]);

    w.manifests.files.set(MANIFEST_PATH, manifest());
    w.clock.advance(120_000);
    await poll(w);
    expect(w.store.actions(REPO_KEY)).toEqual([{ ...record, state: "done", doneAt: w.clock.now().toISOString() }]);
  });

  it("marks a grant done when its row is gone", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7, "grant")] }));
    const row = "#7|grant|2026-10-12T09:00:00Z";
    sentAction(w, { rowId: row, kind: "grant", id: actionId(row, "2026-10-12T09:59:00.000Z") });
    w.manifests.files.set(MANIFEST_PATH, manifest());
    await poll(w);
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ state: "done" });
  });

  it("marks Build it done when the poll reads the spec carrying the ready label, though its row is still in the Inbox", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7, "ready")] }));
    const row = "#7|ready|2026-10-12T09:00:00Z";
    sentAction(w, { rowId: row, kind: "build", id: actionId(row, "2026-10-12T09:59:00.000Z") });
    w.adapters.github.queue(outcome({ snapshots: [snapshot(7, { fleetLabels: ["spec"] })] }));
    await poll(w);
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ state: "sent" });

    w.clock.advance(120_000);
    w.adapters.github.queue(outcome({ snapshots: [snapshot(7, { fleetLabels: ["spec", "status:ready"] })] }));
    await poll(w);
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ state: "done", doneAt: w.clock.now().toISOString() });
  });

  it("reads the label from the read the poll just made, before the cursors commit, even when the wake is refused", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7, "ready")] }));
    const row = "#7|ready|2026-10-12T09:00:00Z";
    sentAction(w, { rowId: row, kind: "build", id: actionId(row, "2026-10-12T09:59:00.000Z") });
    w.channel.mode = "refuse";
    w.adapters.github.queue(outcome({ snapshots: [snapshot(7, { fleetLabels: ["status:ready"] })], events: [event("github:issuecomment:1", 7)] }));
    expect(await poll(w)).toMatchObject({ delivery: "refused" });
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ state: "done" });
  });

  it("marks an action done at a turn-end read too", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    sentAction(w);
    w.manifests.files.set(MANIFEST_PATH, manifest());
    await poll(w, { stateOnly: true });
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ state: "done" });
  });

  it("leaves an action sent after the poll began to the next read", async () => {
    const w = world();
    await start(w, manifest());
    sentAction(w, { sentAt: "2026-10-12T10:00:01.000Z", id: "late" });
    await poll(w);
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ state: "sent" });
  });

  it("decides nothing from a manifest that is missing or unreadable", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    sentAction(w);
    w.manifests.files.delete(MANIFEST_PATH);
    await poll(w);
    w.manifests.files.set(MANIFEST_PATH, "not a manifest");
    await poll(w);
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ state: "sent" });
  });
});

describe("a new manager (AC13)", () => {
  it("drops the actions still sent to the manager before it, and keeps the done ones", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    sentAction(w);
    sentAction(w, { id: "done", rowId: "gone", state: "done", doneAt: "2026-10-12T09:59:30.000Z" });
    w.threads.states.set(MANAGER, "archived");
    w.threads.states.set("thr_second", "live");
    await registerFleet(w.register, "thr_second", args());
    expect(w.store.actions(REPO_KEY).map((action) => action.id)).toEqual(["done"]);
  });

  it("keeps the actions when the same manager registers again", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(7)] }));
    sentAction(w);
    await registerFleet(w.register, MANAGER, args());
    expect(w.store.actions(REPO_KEY)).toHaveLength(1);
  });
});
