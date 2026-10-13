// The Fleets page, the card and the Fleet tab as data (AC1 to AC5, AC8 to AC11, AC14).
import { describe, expect, it } from "vitest";
import { args, inboxRow, issueUrl, manifest, MANAGER, MANIFEST_PATH, pullUrl, REPO_KEY, world, type World } from "../testing/kit";
import { MANAGER_GONE_TEXT } from "../domain/dashboard";
import { createDashboard } from "./dashboard";
import { pollFleet } from "./poll";
import { registerFleet } from "./register";
import type { FleetCardView, FleetsView } from "./views";

const OTHER_MANIFEST = "/work/other/manifest.md";
const OTHER = "thr_other";

const start = async (w: World, text: string | undefined, over = {}) => {
  if (text !== undefined) w.manifests.files.set(MANIFEST_PATH, text);
  await registerFleet(w.register, MANAGER, args(over));
};
const startOther = async (w: World, text: string | undefined) => {
  w.threads.states.set(OTHER, "live");
  if (text !== undefined) w.manifests.files.set(OTHER_MANIFEST, text);
  await registerFleet(w.register, OTHER, args({ repo: "github.com/org/other", manifest: OTHER_MANIFEST }));
};
const view = (w: World) => createDashboard(w.dash);
const fleets = (w: World): Promise<FleetsView> => view(w).fleets();
const cardOf = async (w: World, repo = "github.com/org/repo"): Promise<FleetCardView> => (await fleets(w)).fleets.find((card) => card.repo === repo)!;
const hoursAgo = (w: World, hours: number): string => new Date(w.clock.now().getTime() - hours * 3_600_000).toISOString();
const landedRow = (n: number, merged: string) => `| #${n} | Spec ${n} | ${merged} | ${pullUrl(n + 100)} |`;
const BAD_ROW = (col: string) => `| nope | w | ${col} | 2026-10-12T09:00:00Z | ${issueUrl(1)} |`;

describe("the counts (AC1, AC3)", () => {
  it("counts every Inbox row of a fleet as waiting: readable, waiting for other, sent, and the ones that cannot be read", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(1), inboxRow(2, "other"), inboxRow(3, "grant"), BAD_ROW("answer")] }));
    const sent = { id: "a", repo: REPO_KEY, rowId: "#1|answer|2026-10-12T09:00:00Z", kind: "answer" as const, ref: "#1", what: "w", managerThreadId: MANAGER, state: "sent" as const, sentAt: hoursAgo(w, 0.5), doneAt: null };
    w.store.saveAction(sent);
    expect((await cardOf(w)).waiting).toBe(4);
    expect((await fleets(w)).waiting).toBe(4);
  });

  it("counts the In flight and Blocked rows, and the Landed rows merged in the last 7 days", async () => {
    const w = world();
    const now = w.clock.now().toISOString();
    await start(
      w,
      manifest({
        inFlight: [`| #4 | Build | building | 2026-10-12T09:00:00Z | thr_b | ${pullUrl(4)} |`, `| #5 | Build | at the bar | 2026-10-12T09:00:00Z | — | ${pullUrl(5)} |`, "| bad | x | building | 2026-10-12T09:00:00Z | — | https://github.com/org/repo/pull/6 |"],
        blocked: [`| #10 | #4 | ${issueUrl(10)} |`],
        landed: [landedRow(7, now), landedRow(8, hoursAgo(w, 24 * 3)), landedRow(9, hoursAgo(w, 24 * 8))],
      }),
    );
    expect(await cardOf(w)).toMatchObject({ inFlight: 2, blocked: 1, landed: 2 });
  });

  it("sums the header over all fleets, and counts a fleet with a missing or unreadable manifest as zero", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(1), inboxRow(2)] }));
    await startOther(w, undefined);
    const page = await fleets(w);
    expect(page.fleets.map((card) => [card.repo, card.waiting])).toEqual([["github.com/org/other", 0], ["github.com/org/repo", 2]]);
    expect(page.waiting).toBe(2);
    w.manifests.files.set(OTHER_MANIFEST, "not a manifest");
    expect((await fleets(w)).waiting).toBe(2);
  });

  it("is zero with no fleet registered", async () => {
    expect(await fleets(world())).toMatchObject({ waiting: 0, fleets: [], inbox: [], unreadableInbox: [], recentActions: [], landed: [] });
  });
});

describe("the Inbox table (AC2)", () => {
  it("lists every row of every fleet, the oldest wait first, each with its fleet, link and what it offers", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(1), `| #2 | A grant | grant | 2026-10-12T07:00:00Z | ${issueUrl(2)} |`, inboxRow(3, "ready"), inboxRow(4, "other")] }));
    await startOther(w, manifest({ repo: "github.com/org/other", inbox: [`| — | Merge it | grant | 2026-10-12T08:00:00Z | thread thr_old1, message 7, 2026-10-12T07:59:00Z |`] }));
    const { inbox } = await fleets(w);
    expect(inbox.map((row) => [row.fleet, row.ref, row.since])).toEqual([
      ["github.com/org/repo", "#2", "2026-10-12T07:00:00Z"],
      ["github.com/org/other", "—", "2026-10-12T08:00:00Z"],
      ["github.com/org/repo", "#1", "2026-10-12T09:00:00Z"],
      ["github.com/org/repo", "#3", "2026-10-12T09:00:00Z"],
      ["github.com/org/repo", "#4", "2026-10-12T09:00:00Z"],
    ]);
    const byRef = (ref: string) => inbox.find((row) => row.ref === ref && row.fleet === "github.com/org/repo")!;
    expect(byRef("#1")).toMatchObject({ managerThreadId: MANAGER, waitsFor: "answer", what: "A parked question", link: { kind: "url", url: issueUrl(1), text: "github.com/org/repo/issues/1" }, offer: { kind: "answer", label: "Answer…", regrant: false }, action: null });
    expect(byRef("#2").offer).toEqual({ kind: "grant", label: "Grant…", regrant: false });
    expect(byRef("#3").offer).toEqual({ kind: "build", label: "Build it", regrant: false });
    expect(byRef("#4")).toMatchObject({ waitsFor: "other", offer: null, action: null });
    expect(inbox.find((row) => row.fleet === "github.com/org/other")).toMatchObject({ link: { kind: "message", message: { threadId: "thr_old1", message: 7, at: "2026-10-12T07:59:00Z" } }, offer: { kind: "grant", regrant: true } });
  });

  it("keeps a row's id across reads, and across a change of its What", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(1)] }));
    const first = (await fleets(w)).inbox[0]!.id;
    w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: [inboxRow(1).replace("A parked question", "Reworded")] }));
    expect((await fleets(w)).inbox[0]!.id).toBe(first);
  });

  it("lists an Inbox row it cannot read with its fleet and the column, apart from the rows", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(1), BAD_ROW("answer")] }));
    const page = await fleets(w);
    expect(page.inbox).toHaveLength(1);
    expect(page.unreadableInbox).toEqual([{ fleet: "github.com/org/repo", managerThreadId: MANAGER, line: expect.any(Number), reason: expect.stringContaining("Ref") }]);
  });

  it("shows a row with an action sent as sent, with no offer", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(1)] }));
    const rowId = (await fleets(w)).inbox[0]!.id;
    w.store.saveAction({ id: "x", repo: REPO_KEY, rowId, kind: "answer", ref: "#1", what: "A parked question", managerThreadId: MANAGER, state: "sent", sentAt: "2026-10-12T09:59:00.000Z", doneAt: null });
    expect((await fleets(w)).inbox[0]).toMatchObject({ offer: null, action: { id: "x", fleet: "github.com/org/repo", kind: "answer", state: "sent", sentAt: "2026-10-12T09:59:00.000Z", doneAt: null } });
  });

  it("lists done actions whose row left the Inbox in the last hour, newest first", async () => {
    const w = world();
    await start(w, manifest());
    const done = (id: string, doneAt: string) => w.store.saveAction({ id, repo: REPO_KEY, rowId: id, kind: "answer", ref: "#1", what: "w", managerThreadId: MANAGER, state: "done", sentAt: hoursAgo(w, 3), doneAt });
    done("old", hoursAgo(w, 2));
    done("a", hoursAgo(w, 0.5));
    done("b", hoursAgo(w, 0.1));
    expect((await fleets(w)).recentActions.map((action) => action.id)).toEqual(["b", "a"]);
  });
});

describe("the Recently landed strip (AC5)", () => {
  it("lists specs landed in the last 7 days in any fleet, newest first, with their fleet, title and pull request", async () => {
    const w = world();
    await start(w, manifest({ landed: [landedRow(1, hoursAgo(w, 30)), landedRow(2, hoursAgo(w, 24 * 8)), landedRow(3, hoursAgo(w, 2))] }));
    await startOther(w, manifest({ repo: "github.com/org/other", landed: [landedRow(4, hoursAgo(w, 10))] }));
    const { landed } = await fleets(w);
    expect(landed.map((row) => [row.fleet, row.ref, row.spec])).toEqual([
      ["github.com/org/repo", "#3", "Spec 3"],
      ["github.com/org/other", "#4", "Spec 4"],
      ["github.com/org/repo", "#1", "Spec 1"],
    ]);
    expect(landed[0]!.link).toEqual({ kind: "url", url: pullUrl(103), text: "github.com/org/repo/pull/103" });
  });
});

describe("the card (AC3, AC4, AC14)", () => {
  it("links the fleet's manager and says it is working, idle since a time, or has no manager", async () => {
    const w = world();
    await start(w, manifest());
    w.threads.activity.set(MANAGER, { busy: true, since: "2026-10-12T09:40:00.000Z" });
    expect(await cardOf(w)).toMatchObject({ managerThreadId: MANAGER, manager: { state: "working", since: "2026-10-12T09:40:00.000Z" } });
    w.threads.activity.set(MANAGER, { busy: false, since: "2026-10-12T09:50:00.000Z" });
    expect((await cardOf(w)).manager).toEqual({ state: "idle", since: "2026-10-12T09:50:00.000Z" });
    w.threads.states.set(MANAGER, "archived");
    expect((await cardOf(w)).manager).toEqual({ state: "none", since: null });
    w.threads.states.delete(MANAGER);
    expect((await cardOf(w)).manager).toEqual({ state: "none", since: null });
  });

  it("counts a manager that is archived or gone among the problems, and a live one not", async () => {
    const w = world();
    await start(w, manifest());
    expect((await cardOf(w)).problems).toEqual([]);
    w.threads.states.set(MANAGER, "archived");
    expect((await cardOf(w)).problems).toEqual([{ code: "manager-gone", text: MANAGER_GONE_TEXT, fix: { kind: "none" } }]);
    w.threads.states.delete(MANAGER);
    expect((await cardOf(w)).problems.map((reason) => reason.code)).toEqual(["manager-gone"]);
  });

  it("does not call a manager gone when bb fails to answer for its thread", async () => {
    const w = world();
    await start(w, manifest());
    w.threads.unanswered.add(MANAGER);
    const card = await cardOf(w);
    expect(card.manager).toEqual({ state: "none", since: null });
    expect(card.problems).toEqual([]);
  });

  it("names the service behind the forge", async () => {
    const w = world();
    await start(w, manifest());
    expect((await cardOf(w)).forge).toBe("github");
  });

  it("warns of polling that has never run, then of polling more than two intervals late", async () => {
    const w = world();
    await start(w, manifest());
    expect((await cardOf(w)).warnings).toEqual([{ kind: "never-polled" }]);
    await pollFleet(w.poll, REPO_KEY);
    const polledAt = w.clock.now().toISOString();
    expect((await cardOf(w)).warnings).toEqual([]);
    w.clock.advance(4 * 60_000);
    expect((await cardOf(w)).warnings).toEqual([]);
    w.clock.advance(60_000);
    expect((await cardOf(w)).warnings).toEqual([{ kind: "polling-late", lastPolledAt: polledAt }]);
  });

  it("carries the tracker, when it was last polled and the interval", async () => {
    const w = world();
    await start(w, manifest());
    expect(await cardOf(w)).toMatchObject({ tracker: "forge-issues", lastPolledAt: null, intervalMs: 120_000 });
    await pollFleet(w.poll, REPO_KEY);
    expect((await cardOf(w)).lastPolledAt).toBe(w.clock.now().toISOString());
    w.store.setIntervalMs(REPO_KEY, 45_000);
    expect((await cardOf(w)).intervalMs).toBe(45_000);
  });

  it("labels the manager's cost with the period it covers, and leaves it out when there is none", async () => {
    const w = world();
    await start(w, manifest());
    expect((await cardOf(w)).cost).toBeNull();
    w.cost.costs.set(MANAGER, { amount: 12.5, currency: "USD" });
    expect((await cardOf(w)).cost).toEqual({ amount: 12.5, currency: "USD", period: "since this manager started", sharedWith: [] });
  });

  it("gathers every reason the fleet is not fully watched, with where each is put right", async () => {
    const w = world();
    w.credentials.set([]);
    await start(w, manifest({ inbox: [BAD_ROW("answer"), BAD_ROW("later")], inFlight: ["| nope | x | building | 2026-10-12T09:00:00Z | — | https://github.com/org/repo/pull/6 |"] }));
    const { problems } = await cardOf(w);
    expect(problems.map((reason) => [reason.code, reason.fix.kind])).toEqual([
      ["no-credential", "connect"],
      ["unreadable-rows", "fleet-tab"],
    ]);
    expect(problems[1]!.text).toBe("3 manifest rows cannot be read: In flight, Inbox");
  });

  it("names a missing manifest, which the Fleet tab shows, and a refused credential once a poll found it so, which the settings fix", async () => {
    const w = world();
    await start(w, undefined);
    expect((await cardOf(w)).problems).toEqual([{ code: "manifest-missing", text: expect.stringContaining(MANIFEST_PATH), fix: { kind: "fleet-tab" } }]);
    w.manifests.files.set(MANIFEST_PATH, manifest());
    w.store.savePollState(REPO_KEY, {
      lastPolledAt: w.clock.now().toISOString(),
      notWatched: [],
      unreadableRows: [],
      outsideLinks: [],
      heldSince: null,
      pendingCatchUpMs: null,
      outages: { forge: { unreadablePolls: 0, unreadableSince: null, refused: { since: "2026-10-12T09:00:00.000Z", credential: "github.com/org", announced: true, why: "refused" } } },
    });
    expect((await cardOf(w)).problems).toEqual([{ code: "credential-refused", text: expect.stringContaining("github.com/org"), fix: { kind: "connect", role: "forge" } }]);
  });

  it("sends an unreadable manifest to the Fleet tab, which shows why it cannot be read", async () => {
    const w = world();
    await start(w, "not a manifest");
    expect((await cardOf(w)).problems).toEqual([{ code: "manifest-unreadable", text: expect.stringContaining(MANIFEST_PATH), fix: { kind: "fleet-tab" } }]);
  });

  it("has no reason for a fleet that is fully watched", async () => {
    const w = world();
    await start(w, manifest());
    expect((await cardOf(w)).problems).toEqual([]);
  });

  it("warns of a credential expiring within 7 days, one passed, and a login that shares the agents' rate limit", async () => {
    const w = world();
    w.credentials.set([{ prefix: "github.com/org", service: "github", auth: "gh" }]);
    await start(w, manifest());
    const expiry = new Date(w.clock.now().getTime() + 3 * 86_400_000).toISOString();
    // The fake's credential for github.com/org is kept under that key; its expiry is the one the service last reported.
    w.accounts.addAccount({ id: "account:github.com/org", service: "github", place: "github.com", login: "olivia", name: "olivia", via: "gh", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    w.accounts.saveCredential({ id: "github.com/org", accountId: "account:github.com/org", kind: "gh", owner: null, expiresAt: null, addedAt: "2026-10-12T09:00:00.000Z" }, null);
    const save = (expiresAt: string) => w.accounts.noteExpiry("github.com/org", expiresAt);
    save(expiry);
    await pollFleet(w.poll, REPO_KEY);
    expect((await cardOf(w)).warnings).toEqual([
      { kind: "expires", label: "github.com/org", credentialId: "github.com/org", accountId: "account:github.com/org", role: "forge", expiresAt: expiry, daysLeft: 3 },
      { kind: "shares-rate-limit", label: "github.com/org" },
    ]);
    save(hoursAgo(w, 5));
    expect((await cardOf(w)).warnings[0]).toMatchObject({ kind: "expires", daysLeft: 0 });
    save(new Date(w.clock.now().getTime() + 30 * 86_400_000).toISOString());
    expect((await cardOf(w)).warnings).toEqual([{ kind: "shares-rate-limit", label: "github.com/org" }]);
  });

  it("does not warn of a token credential with no expiry", async () => {
    const w = world();
    await start(w, manifest());
    await pollFleet(w.poll, REPO_KEY);
    expect((await cardOf(w)).warnings).toEqual([]);
  });
});

describe("what a thread is to the Fleet tab (AC9)", () => {
  it("gives a registered manager its card", async () => {
    const w = world();
    await start(w, manifest({ inbox: [inboxRow(1)] }));
    const answer = await view(w).threadFleet({ threadId: MANAGER });
    expect(answer).toMatchObject({ kind: "manager", generatedAt: w.clock.now().toISOString(), fleets: [{ card: { repo: "github.com/org/repo", waiting: 1 }, lastAction: null }] });
  });

  it("gives a manager the action seen done most recently in the last hour whose row left the Inbox", async () => {
    const w = world();
    await start(w, manifest());
    const done = (id: string, doneAt: string) => w.store.saveAction({ id, repo: REPO_KEY, rowId: id, kind: "answer", ref: "#5", what: "Which queue", managerThreadId: MANAGER, state: "done", sentAt: hoursAgo(w, 3), doneAt });
    done("old", hoursAgo(w, 2));
    done("a", hoursAgo(w, 0.5));
    done("b", hoursAgo(w, 0.1));
    const answer = await view(w).threadFleet({ threadId: MANAGER });
    expect(answer).toMatchObject({ kind: "manager", fleets: [{ lastAction: { id: "b", kind: "answer", ref: "#5", what: "Which queue", state: "done" } }] });
  });

  it("names the manager holding the thread's repository when the thread runs no fleet, matching without regard to case or .git", async () => {
    const w = world();
    await start(w, manifest());
    w.repositories.remotes.set("thr_builder_like", "git@GitHub.com:Org/Repo.git");
    expect(await view(w).threadFleet({ threadId: "thr_builder_like" })).toEqual({ kind: "none", holder: { repo: "github.com/org/repo", managerThreadId: MANAGER } });
  });

  it("has no holder when the repository is one no fleet holds, or bb offers none, or the thread is unknown", async () => {
    const w = world();
    await start(w, manifest());
    w.repositories.remotes.set("thr_a", "https://github.com/org/else.git");
    expect(await view(w).threadFleet({ threadId: "thr_a" })).toEqual({ kind: "none", holder: null });
    expect(await view(w).threadFleet({ threadId: "thr_b" })).toEqual({ kind: "none", holder: null });
    expect(await view(w).threadFleet({ threadId: "" })).toEqual({ kind: "none", holder: null });
  });

  it("does not throw when bb fails to say", async () => {
    const w = world();
    w.dash.repositories.remoteOf = () => Promise.reject(new Error("bb is down"));
    await expect(view(w).threadFleet({ threadId: "thr_a" })).resolves.toEqual({ kind: "none", holder: null });
  });
});

describe("the Fleet tab (AC8, AC10, AC11)", () => {
  const rich = (w: World) =>
    manifest({
      inbox: [inboxRow(1), "| nope | x | answer | 2026-10-12T09:00:00Z | https://github.com/org/repo/issues/9 |"],
      inFlight: [`| #2 | Parser | building | 2026-10-12T09:10:00Z | thr_builder | ${pullUrl(22)} |`, `| #3 | Docs | asking | 2026-10-12T09:20:00Z | — | ${issueUrl(3)} |`],
      blocked: [`| #4 | #2, #3 | ${issueUrl(4)} |`],
      landed: [landedRow(5, hoursAgo(w, 30)), landedRow(6, hoursAgo(w, 24 * 9))],
    }) + "\n## Backlog\n\n- #40 Later\n\n## Standing orders\n\nMerge anything green.\n";

  it("refuses a repository no fleet holds", async () => {
    expect(await view(world()).fleetDetail({ repo: "github.com/org/none" })).toEqual({ ok: false, reason: "no fleet is registered for github.com/org/none" });
    expect(await view(world()).fleetDetail({ repo: "nonsense" })).toMatchObject({ ok: false });
  });

  it("shows the whole manifest: Inbox, In flight with builders and times, Blocked, the last 7 days landed, the sections as written, and the rows it cannot read", async () => {
    const w = world();
    await start(w, rich(w));
    const answer = await view(w).fleetDetail({ repo: "GitHub.com/Org/Repo" });
    if (!answer.ok) throw new Error(answer.reason);
    const { manifest: shown } = answer.detail;
    if (shown.status !== "ok") throw new Error("not ok");
    expect(shown.inbox.map((row) => row.ref)).toEqual(["#1"]);
    expect(shown.unreadableInbox).toHaveLength(1);
    expect(shown.inFlight).toEqual([
      { ref: "#2", work: "Parser", stage: "building", since: "2026-10-12T09:10:00Z", builderThreadId: "thr_builder", link: { kind: "url", url: pullUrl(22), text: "github.com/org/repo/pull/22" } },
      { ref: "#3", work: "Docs", stage: "asking", since: "2026-10-12T09:20:00Z", builderThreadId: null, link: { kind: "url", url: issueUrl(3), text: "github.com/org/repo/issues/3" } },
    ]);
    expect(shown.blocked).toEqual([{ ref: "#4", blockedOn: ["#2", "#3"], link: expect.objectContaining({ kind: "url" }) }]);
    expect(shown.landed.map((row) => row.ref)).toEqual(["#5"]);
    expect(shown.unreadable).toEqual([{ section: "Inbox", line: expect.any(Number), reason: expect.stringContaining("Ref") }]);
    expect(shown.written).toEqual([
      { heading: "Backlog", markdown: "- #40 Later" },
      { heading: "Standing orders", markdown: "Merge anything green." },
    ]);
  });

  it("says a manifest is missing or unreadable", async () => {
    const w = world();
    await start(w, undefined);
    const detail = async () => {
      const answer = await view(w).fleetDetail({ repo: "github.com/org/repo" });
      if (!answer.ok) throw new Error(answer.reason);
      return answer.detail;
    };
    expect((await detail()).manifest).toEqual({ status: "missing" });
    w.manifests.files.set(MANIFEST_PATH, "not a manifest");
    expect((await detail()).manifest).toEqual({ status: "unreadable", reason: expect.any(String) });
  });

  it("gives the watched set with why each item is in it, labels from the cursor included (AC10)", async () => {
    const w = world();
    await start(w, rich(w));
    w.store.commit({
      repo: REPO_KEY,
      at: w.clock.now().toISOString(),
      cursors: [{ role: "forge", cursor: { since: "2026-10-12T09:00:00.000Z", items: { "forge:#1": { open: true, merged: false, fleetLabels: ["spec"], inPartition: true }, "forge:#50": { open: true, merged: false, fleetLabels: ["status:ready"], inPartition: true } } } }],
    });
    const answer = await view(w).fleetDetail({ repo: "github.com/org/repo" });
    if (!answer.ok) throw new Error(answer.reason);
    const watched = Object.fromEntries(answer.detail.watched.map((item) => [item.ref, item.why]));
    expect(watched["#1"]).toEqual(["named in Inbox", "carries the spec label"]);
    expect(watched["#2"]).toEqual(["named in In flight", "named in Blocked"]);
    expect(watched["#4"]).toEqual(["blocked on #2, #3"]);
    expect(watched["#50"]).toEqual(["carries the status:ready label"]);
  });

  it("gives the credentials with their account, expiry and whether they share the rate limit, the requests this hour, and the poll state (AC11, #253 AC14)", async () => {
    const w = world();
    w.credentials.set([{ prefix: "github.com/org", service: "github", auth: "glab" }]);
    w.accounts.addAccount({ id: "account:github.com/org", service: "gitlab", place: "gitlab.com", login: "olivia", name: "olivia", via: "glab", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    w.accounts.saveCredential({ id: "github.com/org", accountId: "account:github.com/org", kind: "glab", owner: null, expiresAt: "2027-01-01T00:00:00.000Z", addedAt: "2026-10-12T09:00:00.000Z" }, null);
    await start(w, manifest());
    w.store.recordPoll(REPO_KEY, { at: hoursAgo(w, 0.5), role: "forge", requests: [], counted: 7, ok: true });
    w.store.recordPoll(REPO_KEY, { at: hoursAgo(w, 3), role: "forge", requests: [], counted: 50, ok: true });
    w.store.savePollState(REPO_KEY, { lastPolledAt: "2026-10-12T09:58:00.000Z", notWatched: [], unreadableRows: [], outsideLinks: [], heldSince: null, pendingCatchUpMs: null, outages: {} });
    const answer = await view(w).fleetDetail({ repo: "github.com/org/repo" });
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.detail.credentials).toEqual([
      { role: "forge", label: "github.com/org", account: { id: "account:github.com/org", label: "github.com/org" }, kind: "glab", auth: "glab", expiresAt: "2027-01-01T00:00:00.000Z", canWrite: true, sharesAgentRateLimit: true },
    ]);
    expect(answer.detail.requestsThisHour).toBe(7);
    expect(answer.detail.failedReads).toBe(0);
    expect(answer.detail.lastAction).toBeNull();
    expect(answer.detail.card).toMatchObject({ lastPolledAt: "2026-10-12T09:58:00.000Z", intervalMs: 120_000 });
    expect(answer.detail.generatedAt).toBe(w.clock.now().toISOString());
  });
});

describe("the Ledger tab's count (#258 AC2)", () => {
  it("counts the reads that failed in the last 24 hours", async () => {
    const w = world();
    await start(w, manifest());
    const failed = (hours: number) => w.store.recordFailedRead(REPO_KEY, { at: hoursAgo(w, hours), role: "forge", ref: null, reason: "listing returned 500" });
    const count = async () => {
      const answer = await view(w).fleetDetail({ repo: "github.com/org/repo" });
      if (!answer.ok) throw new Error(answer.reason);
      return answer.detail.failedReads;
    };
    expect(await count()).toBe(0);
    failed(2);
    expect(await count()).toBe(1);
    failed(25);
    failed(23.9);
    expect(await count()).toBe(2);
  });
});

describe("what a view carries", () => {
  it("lists at most 200 rows of the Inbox for a fleet and still counts them all, and clips a long What", async () => {
    const w = world();
    const rows = Array.from({ length: 250 }, (_, n) => `| #${n + 1} | ${"w".repeat(2000)} | answer | 2026-10-12T09:00:00Z | ${issueUrl(n + 1)} |`);
    await start(w, manifest({ inbox: rows }));
    const page = await fleets(w);
    expect(page.waiting).toBe(250);
    expect(page.inbox).toHaveLength(200);
    expect(page.inbox[0]!.what.length).toBe(500);
    expect(JSON.stringify(page).length).toBeLessThan(1024 * 1024);
  });
});
