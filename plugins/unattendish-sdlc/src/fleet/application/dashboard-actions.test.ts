// The three actions sent to a manager (AC13).
import { describe, expect, it } from "vitest";
import { args, inboxRow, issueUrl, manifest, MANAGER, MANIFEST_PATH, REPO_KEY, TOKEN, world, type World } from "../testing/kit";
import { createDashboard } from "./dashboard";
import { pollFleet } from "./poll";
import { registerFleet } from "./register";

const GRANT_LINK = "thread thr_old1, message 7, 2026-10-12T07:59:00Z";
const OWN_LINK = "this thread, message 12, 2026-10-12T07:59:00Z";

const start = async (w: World, rows: string[]) => {
  w.manifests.files.set(MANIFEST_PATH, manifest({ inbox: rows }));
  await registerFleet(w.register, MANAGER, args());
};
const dashboard = (w: World) => createDashboard(w.dash);
const rowId = async (w: World, ref: string): Promise<string> => (await dashboard(w).fleets()).inbox.find((row) => row.ref === ref)!.id;
const REPO = "github.com/org/repo";

describe("sending an action", () => {
  it("sends Answer to <Ref>: <text> as a plain prompt to the manager, queued behind a running turn, and records it as sent", async () => {
    const w = world();
    w.channel.mode = "busy";
    await start(w, [inboxRow(7)]);
    const result = await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#7"), kind: "answer", text: "Use B.\nIt is simpler.\n" });
    expect(result).toEqual({ ok: true, action: { id: expect.any(String), fleet: REPO, kind: "answer", ref: "#7", what: "A parked question", state: "sent", sentAt: w.clock.now().toISOString(), doneAt: null } });
    expect(w.channel.sent).toEqual([{ threadId: MANAGER, text: "Answer to #7: Use B.\nIt is simpler.\n", id: "q1" }]);
    expect(w.store.actions(REPO_KEY)).toHaveLength(1);
    expect(w.events.boardChanges).toBeGreaterThan(0);
  });

  it("sends Answer to message <n>: <text> where the Ref is —", async () => {
    const w = world();
    await start(w, [`| — | Which of the two? | answer | 2026-10-12T09:00:00Z | ${OWN_LINK} |`]);
    await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "—"), kind: "answer", text: "The first" });
    expect(w.channel.sent[0]!.text).toBe("Answer to message 12: The first");
  });

  it("sends Grant: <text>", async () => {
    const w = world();
    await start(w, [inboxRow(7, "grant")]);
    await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#7"), kind: "grant", text: "Merge it once green" });
    expect(w.channel.sent[0]!.text).toBe("Grant: Merge it once green");
  });

  it("sends Re-grant as Grant: <What> in one click, only on a row whose Link names a previous manager's message", async () => {
    const w = world();
    await start(w, [`| — | Merge the rollout | grant | 2026-10-12T09:00:00Z | ${GRANT_LINK} |`, `| — | Own grant | grant | 2026-10-12T09:01:00Z | ${OWN_LINK} |`]);
    const { inbox } = await dashboard(w).fleets();
    const old = inbox.find((row) => row.what === "Merge the rollout")!;
    const own = inbox.find((row) => row.what === "Own grant")!;
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: own.id, kind: "grant", regrant: true })).toMatchObject({ ok: false });
    expect(w.channel.sent).toEqual([]);
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: old.id, kind: "grant", regrant: true })).toMatchObject({ ok: true });
    expect(w.channel.sent.map((message) => message.text)).toEqual(["Grant: Merge the rollout"]);
  });

  it("sends Build <Ref>", async () => {
    const w = world();
    await start(w, [inboxRow(7, "ready")]);
    await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#7"), kind: "build" });
    expect(w.channel.sent[0]!.text).toBe("Build #7");
  });

  it.each([undefined, "", "  \n "])("refuses Answer… and Grant… with text %j, and sends nothing", async (text) => {
    const w = world();
    await start(w, [inboxRow(7), inboxRow(8, "grant")]);
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#7"), kind: "answer", text })).toMatchObject({ ok: false });
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#8"), kind: "grant", text })).toMatchObject({ ok: false });
    expect(w.channel.sent).toEqual([]);
    expect(w.store.actions(REPO_KEY)).toEqual([]);
  });

  it("refuses an unknown row, an unknown fleet, an action the row does not offer, and a row waiting for other", async () => {
    const w = world();
    await start(w, [inboxRow(7), inboxRow(8, "other")]);
    const send = (over: Partial<Parameters<ReturnType<typeof dashboard>["sendAction"]>[0]>) => dashboard(w).sendAction({ fleet: REPO, rowId: "nope", kind: "answer", text: "x", ...over });
    expect(await send({})).toMatchObject({ ok: false, reason: expect.stringContaining("no longer") });
    expect(await send({ fleet: "github.com/org/none" })).toMatchObject({ ok: false, reason: expect.stringContaining("no fleet") });
    expect(await send({ rowId: await rowId(w, "#7"), kind: "grant" })).toMatchObject({ ok: false });
    expect(await send({ rowId: await rowId(w, "#8") })).toMatchObject({ ok: false });
    expect(w.channel.sent).toEqual([]);
  });

  it("refuses a second action on a row while one is sent, and while the result shows done", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    const id = await rowId(w, "#7");
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "A" })).toMatchObject({ ok: true });
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "B" })).toMatchObject({ ok: false, reason: expect.stringContaining("already sent") });
    expect(w.channel.sent).toHaveLength(1);
  });

  it("sends once for two sends made together", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    const id = await rowId(w, "#7");
    const api = dashboard(w);
    const results = await Promise.all([api.sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "A" }), api.sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "B" })]);
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect(w.channel.sent).toHaveLength(1);
  });

  it("answers with bb's own reason when bb refuses, records nothing, and the row keeps its action", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    w.channel.mode = "refuse";
    w.channel.refusal = "HTTP 409: Thread is archived";
    const id = await rowId(w, "#7");
    const result = await dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "The plan is B" });
    expect(result).toEqual({ ok: false, reason: "HTTP 409: Thread is archived" });
    expect(w.store.actions(REPO_KEY)).toEqual([]);
    expect((await dashboard(w).fleets()).inbox[0]).toMatchObject({ offer: { kind: "answer" }, action: null });
    w.channel.mode = "idle";
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "Try again" })).toMatchObject({ ok: true });
  });

  it("scrubs a stored token from bb's reason once more", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    w.channel.mode = "refuse";
    w.channel.refusal = `HTTP 400: bad header ${TOKEN}`;
    const result = await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#7"), kind: "answer", text: "x1x1x1" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("keeps a sent action sent through any number of polls, with its age, and never marks it failed", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    const id = await rowId(w, "#7");
    await dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "A" });
    for (let n = 0; n < 6; n += 1) {
      w.clock.advance(120_000);
      await pollFleet(w.poll, REPO_KEY);
    }
    const row = (await dashboard(w).fleets()).inbox[0]!;
    expect(row).toMatchObject({ offer: null, action: { state: "sent", doneAt: null, sentAt: "2026-10-12T10:00:00.000Z" } });
  });

  it("shows the action as done once a poll sees the row gone, then lists it as a recent action, and the Inbox no longer holds the row", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    const id = await rowId(w, "#7");
    await dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "A" });
    w.manifests.files.set(MANIFEST_PATH, manifest());
    w.clock.advance(120_000);
    await pollFleet(w.poll, REPO_KEY);
    const page = await dashboard(w).fleets();
    expect(page.inbox).toEqual([]);
    expect(page.recentActions).toEqual([{ id: expect.any(String), fleet: REPO, kind: "answer", ref: "#7", what: "A parked question", state: "done", sentAt: "2026-10-12T10:00:00.000Z", doneAt: w.clock.now().toISOString() }]);
  });

  it("shows another window the same sent action: the record is the plugin's, not the window's", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#7"), kind: "answer", text: "A" });
    const reloaded = createDashboard(w.dash);
    expect((await reloaded.fleets()).inbox[0]).toMatchObject({ offer: null, action: { state: "sent" } });
    expect((await reloaded.fleetDetail({ repo: REPO }).then((r) => (r.ok && r.detail.manifest.status === "ok" ? r.detail.manifest.inbox[0] : null)))).toMatchObject({ offer: null, action: { state: "sent" } });
  });

  it("drops a record when the fleet is unregistered, and does not show it for a fleet registered again", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    await dashboard(w).sendAction({ fleet: REPO, rowId: await rowId(w, "#7"), kind: "answer", text: "A" });
    w.store.removeFleet(REPO_KEY);
    expect(w.store.actions(REPO_KEY)).toEqual([]);
  });
});

describe("an action and a take-over", () => {
  const takeOver = async (w: World) => {
    w.threads.states.set(MANAGER, "archived");
    w.threads.states.set("thr_second", "live");
    await registerFleet(w.register, "thr_second", args());
  };

  it("records nothing, and says so, when the fleet changes manager while the message is being sent", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    const id = await rowId(w, "#7");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const send = w.channel.send.bind(w.channel);
    w.channel.send = async (threadId, text) => {
      await held;
      return send(threadId, text);
    };
    const sending = dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "A" });
    await takeOver(w);
    release();
    expect(await sending).toMatchObject({ ok: false, reason: expect.stringContaining("changed manager") });
    expect(w.store.actions(REPO_KEY)).toEqual([]);
    w.channel.send = send;
    expect(await dashboard(w).sendAction({ fleet: REPO, rowId: id, kind: "answer", text: "A again" })).toMatchObject({ ok: true });
    expect(w.channel.sent.at(-1)).toMatchObject({ threadId: "thr_second", text: "Answer to #7: A again" });
  });

  it("offers the row again when the action on it was sent to a manager since replaced, and never marks it done", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    const id = await rowId(w, "#7");
    w.store.saveAction({ id: "stale", repo: REPO_KEY, rowId: id, kind: "answer", ref: "#7", what: "w", managerThreadId: MANAGER, state: "sent", sentAt: "2026-10-12T09:59:00.000Z", doneAt: null });
    await takeOver(w);
    w.store.saveAction({ id: "stale", repo: REPO_KEY, rowId: id, kind: "answer", ref: "#7", what: "w", managerThreadId: MANAGER, state: "sent", sentAt: "2026-10-12T09:59:00.000Z", doneAt: null });
    expect((await dashboard(w).fleets()).inbox[0]).toMatchObject({ offer: { kind: "answer" }, action: null });
    w.manifests.files.set(MANIFEST_PATH, manifest());
    await pollFleet(w.poll, REPO_KEY);
    expect(w.store.actions(REPO_KEY)[0]).toMatchObject({ id: "stale", state: "sent" });
  });
});

describe("a Link in the Inbox", () => {
  it("is a URL for a row with a Ref", async () => {
    const w = world();
    await start(w, [inboxRow(7)]);
    expect((await dashboard(w).fleets()).inbox[0]!.link).toMatchObject({ kind: "url", url: issueUrl(7) });
  });
});
