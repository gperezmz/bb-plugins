import { describe, expect, it } from "vitest";
import { ACTION_TEXT_MAX_CHARS, actionId, actionMessage, finishedActions, latestOn, planAction, recentActions, type ActionRecord, type ActionRequest } from "./actions";
import type { InboxRow } from "./model";

const row = (over: Partial<InboxRow> = {}): InboxRow => ({ ref: "#163", what: "Which cache?", waitsFor: "answer", since: "2026-10-12T09:30:00Z", link: "https://github.com/org/repo/issues/163", ...over });
const request = (over: Partial<ActionRequest> = {}): ActionRequest => ({ row: row(), kind: "answer", text: "Use B", managerThreadId: "thr_m", taken: false, ...over });
const park = row({ ref: "—", waitsFor: "grant", what: "Merge the rollout", link: "thread thr_old, message 12, 2026-10-12T07:29:00Z" });

describe("actionMessage", () => {
  it("sends Answer to <Ref>: <text>", () => {
    expect(actionMessage("answer", row(), "Use B", false)).toBe("Answer to #163: Use B");
  });

  it("sends Answer to message <n>: <text> where the Ref is —", () => {
    expect(actionMessage("answer", row({ ref: "—", link: "this thread, message 12, 2026-10-12T07:29:00Z" }), "Use B", false)).toBe("Answer to message 12: Use B");
  });

  it("sends Grant: <text>, and for Re-grant Grant: <What>", () => {
    expect(actionMessage("grant", park, "Merge it", false)).toBe("Grant: Merge it");
    expect(actionMessage("grant", park, "", true)).toBe("Grant: Merge the rollout");
  });

  it("sends Build <Ref>", () => {
    expect(actionMessage("build", row({ ref: "ENG-4", waitsFor: "ready" }), "", false)).toBe("Build ENG-4");
  });

  it("sends the text whole, over several lines, with nothing added", () => {
    expect(actionMessage("answer", row(), "Use B.\n\nBecause:\n- one\n- two\n", false)).toBe("Answer to #163: Use B.\n\nBecause:\n- one\n- two\n");
  });
});

describe("planAction", () => {
  it("plans the message for a row that offers the action", () => {
    expect(planAction(request())).toEqual({ ok: true, message: "Answer to #163: Use B" });
    expect(planAction(request({ row: row({ waitsFor: "ready", ref: "#9" }), kind: "build", text: undefined }))).toEqual({ ok: true, message: "Build #9" });
    expect(planAction(request({ row: park, kind: "grant", regrant: true, text: undefined }))).toEqual({ ok: true, message: "Grant: Merge the rollout" });
  });

  it.each([undefined, "", "   \n\t"])("refuses Answer… and Grant… with text %j", (text) => {
    expect(planAction(request({ text }))).toMatchObject({ ok: false });
    expect(planAction(request({ row: row({ waitsFor: "grant" }), kind: "grant", text }))).toMatchObject({ ok: false });
  });

  it("refuses an unknown row, an action the row does not offer, and a row waiting for other", () => {
    expect(planAction(request({ row: undefined }))).toMatchObject({ ok: false, reason: expect.stringContaining("no longer") });
    expect(planAction(request({ kind: "grant" }))).toMatchObject({ ok: false, reason: expect.stringContaining("offers Answer…") });
    expect(planAction(request({ row: row({ waitsFor: "other" }) }))).toMatchObject({ ok: false });
  });

  it("refuses a row that has an action in flight", () => {
    expect(planAction(request({ taken: true }))).toMatchObject({ ok: false, reason: expect.stringContaining("already sent") });
  });

  it("refuses Re-grant on a row that does not offer it, and on another action", () => {
    expect(planAction(request({ row: row({ waitsFor: "grant" }), kind: "grant", regrant: true }))).toMatchObject({ ok: false });
    expect(planAction(request({ regrant: true }))).toMatchObject({ ok: false });
  });

  it("refuses a Build it with no Ref and an answer to a row naming no message", () => {
    expect(planAction(request({ row: row({ ref: "—", waitsFor: "ready", link: "this thread, message 1, 2026-10-12T07:29:00Z" }), kind: "build" }))).toMatchObject({ ok: false });
  });

  it("refuses text over the limit", () => {
    expect(planAction(request({ text: "x".repeat(ACTION_TEXT_MAX_CHARS + 1) }))).toMatchObject({ ok: false });
  });
});

const record = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: "a1",
  repo: "github.com/org/repo",
  rowId: "r1",
  kind: "answer",
  ref: "#163",
  what: "Which cache?",
  managerThreadId: "thr_m",
  state: "sent",
  sentAt: "2026-10-12T10:00:00.000Z",
  doneAt: null,
  ...over,
});

describe("finishedActions", () => {
  const never = () => false;

  it("finishes an answer or a grant when its row is gone from the Inbox, and not before", () => {
    const sent = [record({ id: "a" }), record({ id: "g", kind: "grant", rowId: "r2" })];
    expect(finishedActions(sent, new Set(["r1", "r2"]), never)).toEqual([]);
    expect(finishedActions(sent, new Set(["r2"]), never)).toEqual(["a"]);
    expect(finishedActions(sent, new Set(), never)).toEqual(["a", "g"]);
  });

  it("finishes a Build it when the spec carries the ready label, though its row is still in the Inbox", () => {
    const sent = [record({ id: "b", kind: "build", ref: "#9" })];
    expect(finishedActions(sent, new Set(["r1"]), (ref) => ref === "#9")).toEqual(["b"]);
    expect(finishedActions(sent, new Set(["r1"]), never)).toEqual([]);
  });

  it("does not finish an answer by the ready label", () => {
    expect(finishedActions([record()], new Set(["r1"]), () => true)).toEqual([]);
  });

  it("leaves a record already done alone", () => {
    expect(finishedActions([record({ state: "done", doneAt: "2026-10-12T10:05:00.000Z" })], new Set(), never)).toEqual([]);
  });
});

describe("recentActions", () => {
  const now = new Date("2026-10-12T11:00:00.000Z");
  const done = (id: string, doneAt: string, rowId = id) => record({ id, rowId, state: "done", doneAt });

  it("lists done actions whose row left the Inbox in the last hour, newest first", () => {
    const records = [done("a", "2026-10-12T10:10:00.000Z"), done("b", "2026-10-12T10:50:00.000Z"), done("c", "2026-10-12T09:30:00.000Z"), done("d", "2026-10-12T10:55:00.000Z"), record({ id: "e", rowId: "e" })];
    expect(recentActions(records, new Set(["d"]), now).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("latestOn", () => {
  it("finds the latest record of a row", () => {
    const records = [record({ id: "old", sentAt: "2026-10-12T09:00:00.000Z" }), record({ id: "new", sentAt: "2026-10-12T10:00:00.000Z" }), record({ id: "other", rowId: "r2" })];
    expect(latestOn(records, "r1")!.id).toBe("new");
    expect(latestOn(records, "none")).toBeNull();
    expect(actionId("r1", "t")).toBe("t|r1");
  });
});
