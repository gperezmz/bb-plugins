// A manager thread holding two fleets, and a fleet whose manifest names another repository (#270 AC5, AC6).
import { describe, expect, it } from "vitest";
import { leftBehindText } from "../domain/dashboard";
import { args, inboxRow, manifest, MANAGER, MANIFEST_PATH, outcome, REPO, REPO_KEY, world, type World } from "../testing/kit";
import { createDashboard } from "./dashboard";
import { pollFleet } from "./poll";
import { registerFleet } from "./register";
import { fleetStatus } from "./status";

const WAKE = "github.com/org/wake";

/** Thread MANAGER registers REPO and then WAKE, both with the one manifest, which then names WAKE. */
const holdBoth = async (w: World, rows: string[]) => {
  w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: rows }));
  await registerFleet(w.register, MANAGER, args());
  w.manifests.files.set(MANIFEST_PATH, manifest({ repo: WAKE, inbox: rows }));
  await registerFleet(w.register, MANAGER, args({ repo: WAKE }));
};
const view = (w: World) => createDashboard(w.dash);
const cardOf = async (w: World, repo: string) => (await view(w).fleets()).fleets.find((card) => card.repo === repo)!;

describe("a fleet whose manifest names another repository (#270 AC6)", () => {
  it("shows none of the manifest's rows and no counts, and carries the left-behind problem with no verb", async () => {
    const w = world();
    await holdBoth(w, [inboxRow(1), inboxRow(2)]);
    const page = await view(w).fleets();
    const dash = page.fleets.find((card) => card.repo === REPO)!;
    const wake = page.fleets.find((card) => card.repo === WAKE)!;
    expect(wake).toMatchObject({ waiting: 2, problems: [] });
    expect(dash).toMatchObject({ waiting: 0, inFlight: 0, blocked: 0, landed: 0 });
    expect(dash.problems).toEqual([{ code: "left-behind", text: leftBehindText(REPO, WAKE), fix: { kind: "none" } }]);
    expect(leftBehindText(REPO, WAKE)).toBe("Its manifest now names github.com/org/wake, so nothing in it is this fleet's. Unregister it with `bb unattendish fleet unregister github.com/org/repo`.");
    expect(page.inbox.map((row) => row.fleet)).toEqual([WAKE, WAKE]);
    expect(page.waiting).toBe(2);
  });

  it("shows nothing of the manifest in its Fleet tab", async () => {
    const w = world();
    await holdBoth(w, [inboxRow(5)]);
    const result = await view(w).fleetDetail({ repo: REPO });
    if (!result.ok) throw new Error(result.reason);
    expect(result.detail.manifest).toEqual({ status: "left-behind", names: WAKE });
    expect(result.detail.watched).toEqual([]);
  });

  it("refuses an action on one of the manifest's rows", async () => {
    const w = world();
    await holdBoth(w, [inboxRow(7)]);
    const row = (await view(w).fleets()).inbox[0]!;
    const result = await view(w).sendAction({ fleet: REPO, rowId: row.id, kind: "answer", text: "Use B." });
    expect(result.ok).toBe(false);
    expect(w.channel.sent).toEqual([]);
  });

  it("raises a new Inbox row's toast for the fleet the manifest names alone", async () => {
    const w = world();
    await holdBoth(w, [inboxRow(1)]);
    w.manifests.files.set(MANIFEST_PATH, manifest({ repo: WAKE, inbox: [inboxRow(1), inboxRow(2)] }));
    for (const repo of [REPO_KEY, "github.com/org/wake"]) {
      w.adapters.github.queue(outcome());
      await pollFleet(w.poll, repo);
    }
    expect(w.events.inboxNews.map((news) => [news.fleet, news.ref])).toEqual([[WAKE, "#2"]]);
  });

  it("fetches no item because the manifest names it", async () => {
    const w = world();
    await holdBoth(w, [inboxRow(5)]);
    w.adapters.github.queue(outcome());
    await pollFleet(w.poll, REPO_KEY);
    expect(w.adapters.github.reads[0]!.items).toEqual([]);
  });

  it("says in `fleet status` that it is left behind, watched, with none of the manifest's rows or items", async () => {
    const w = world();
    await holdBoth(w, ["| nope | w | answer | 2026-10-12T09:00:00Z | x |", "| #9 | x | answer | 2026-10-12T09:00:00Z | https://github.com/elsewhere/x/issues/9 |"]);
    const dash = (await fleetStatus({ ...w.register, clock: w.clock })).find((fleet) => fleet.repo === REPO)!;
    expect(dash).toMatchObject({ watched: true, leftBehind: { names: WAKE }, unreadableRows: [], outside: [] });
    const wake = (await fleetStatus({ ...w.register, clock: w.clock })).find((fleet) => fleet.repo === WAKE)!;
    expect(wake.leftBehind).toBeNull();
  });

  it("shows its rows again, without the problem, once the manifest names it again", async () => {
    const w = world();
    await holdBoth(w, [inboxRow(1)]);
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(1)] }));
    const dash = await cardOf(w, REPO);
    expect(dash).toMatchObject({ waiting: 1, problems: [] });
    expect((await cardOf(w, WAKE)).problems.map((problem) => problem.code)).toEqual(["left-behind"]);
  });
});

describe("one manager thread holding two fleets (#270 AC5, AC7)", () => {
  it("gives the Fleet chip and tab every fleet the thread holds", async () => {
    const w = world();
    await holdBoth(w, [inboxRow(1)]);
    const thread = await view(w).threadFleet({ threadId: MANAGER });
    if (thread.kind !== "manager") throw new Error("not a manager");
    expect(thread.fleets.map((fleet) => fleet.card.repo).sort()).toEqual([REPO, WAKE]);
  });

  it("marks each fleet's spend as shared with the others on the thread, and a fleet alone unmarked", async () => {
    const w = world();
    w.cost.costs.set(MANAGER, { amount: 4.12, currency: "$" });
    await holdBoth(w, []);
    expect((await cardOf(w, REPO)).cost).toMatchObject({ amount: 4.12, sharedWith: [WAKE] });
    expect((await cardOf(w, WAKE)).cost).toMatchObject({ amount: 4.12, sharedWith: [REPO] });
    w.store.removeFleet(REPO_KEY);
    expect((await cardOf(w, WAKE)).cost).toMatchObject({ amount: 4.12, sharedWith: [] });
    const thread = await view(w).threadFleet({ threadId: MANAGER });
    expect(thread.kind === "manager" ? thread.fleets.length : 0).toBe(1);
  });
});
