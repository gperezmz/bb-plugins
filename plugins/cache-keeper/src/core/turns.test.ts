import { describe, expect, it } from "vitest";
import { checkInText, keepWarmText } from "./messages";
import { emptyTurnLog, foldTurns, isKeeperTurn, broughtNothingNew, originsOf, reportPending, type BbEvent, type TurnLog } from "./turns";

const clock = () => "14:30";
const KEEP_WARM = keepWarmText([{ kind: "command", id: "b1", description: "deploy", startedAt: 0 }], [], clock);
const NOT_FINISHED = 'Not finished yet, still waiting on background command b1 ("deploy"). Nothing needed from you.';

/** Builds a thread's events the way bb 0.44 writes them. */
class History {
  events: BbEvent[] = [];
  private seq = 0;
  private req = 0;
  private push(type: string, at: number, data: unknown) {
    this.events.push({ seq: ++this.seq, type, createdAt: at, data });
  }
  /** A request, then a turn that takes it and replies. */
  turn(at: number, input: unknown[], reply: string, status = "completed", initiator = "user") {
    const id = this.request(at, input, initiator);
    this.push("turn/started", at + 100, {});
    this.push("turn/input/accepted", at + 100, { clientRequestId: id });
    this.push("item/completed", at + 500, { item: { type: "agentMessage", id: "m", text: reply } });
    this.push("turn/completed", at + 1000, { status });
    return this;
  }
  request(at: number, input: unknown[], initiator = "user") {
    const id = `creq_${++this.req}`;
    this.push("client/turn/requested", at, { requestId: id, initiator, input, target: { kind: "new-turn" } });
    return id;
  }
  /** A turn with no input: Claude Code woken by a background task finishing. */
  wake(at: number) {
    this.push("turn/started", at, {});
    this.push("turn/completed", at + 1000, { status: "completed" });
    return this;
  }
  log(): TurnLog {
    return foldTurns(emptyTurnLog(), this.events);
  }
}

const text = (t: string) => [{ type: "text", text: t, mentions: [] }];

/** bb's report of one child's turn, or a batch naming several. */
function report(children: { id: string; status?: string }[], reply = NOT_FINISHED): unknown[] {
  if (children.length === 1) {
    const mention = `@thread:${children[0]!.id}`;
    const body = `[bb system]\n\n${mention} ${children[0]!.status ?? "completed"}:\n\n${reply}`;
    return [{ type: "text", text: body, mentions: [{ start: 13, end: 13 + mention.length, resource: { kind: "thread", threadId: children[0]!.id, label: "c" } }] }];
  }
  let body = "[bb system]\n\nChild thread updates:\n\n";
  const mentions: unknown[] = [];
  children.forEach((c, i) => {
    if (i > 0) body += "\n";
    body += "- ";
    const mention = `@thread:${c.id}`;
    mentions.push({ start: body.length, end: body.length + mention.length, resource: { kind: "thread", threadId: c.id, label: c.id } });
    body += `${mention} ${c.status ?? "completed"}.`;
  });
  return [{ type: "text", text: body, mentions }];
}

describe("turn attribution", () => {
  it("counts a keep-warm turn and the parent's report of it as Cache Keeper's, bringing nothing new", () => {
    const child = new History().turn(1_000, text("BACKGROUND please"), "Started it.").turn(300_000, text(KEEP_WARM), NOT_FINISHED).log();
    // bb reported the child's first turn too, when it ended.
    const parent = new History().turn(3_000, report([{ id: "c" }], "Started it."), "ok", "completed", "system").turn(302_000, report([{ id: "c" }]), "Noted.", "completed", "system").log();
    const lookup = (id: string) => (id === "c" ? child : parent);

    expect(isKeeperTurn("child", child.turns[0]!, lookup)).toBe(false);
    expect(isKeeperTurn("child", child.turns[1]!, lookup)).toBe(true);
    expect(broughtNothingNew("child", child.turns[1]!, lookup)).toBe(true);
    expect(isKeeperTurn("parent", parent.turns[0]!, lookup)).toBe(false);
    expect(isKeeperTurn("parent", parent.turns[1]!, lookup)).toBe(true);
    expect(broughtNothingNew("parent", parent.turns[1]!, lookup)).toBe(true);
    expect(originsOf("p", parent.turns[1]!, lookup)).toEqual([{ threadId: "c", at: 300_000, text: KEEP_WARM }]);
  });

  it("follows reports up any number of levels", () => {
    const leaf = new History().turn(0, text(KEEP_WARM), NOT_FINISHED).log();
    const mid = new History().turn(3_000, report([{ id: "leaf" }]), "ok", "completed", "system").log();
    const top = new History().turn(6_000, report([{ id: "mid" }]), "ok", "completed", "system").log();
    const lookup = (id: string) => ({ leaf, mid, top })[id] ?? null;
    expect(isKeeperTurn("top", top.turns[0]!, lookup)).toBe(true);
    expect(originsOf("top", top.turns[0]!, lookup).map((o) => o.threadId)).toEqual(["leaf"]);
  });

  it("makes a batch real when any child turn in it was real, and nothing new only when every child brought nothing new", () => {
    const a = new History().turn(0, text(KEEP_WARM), NOT_FINISHED).log();
    const b = new History().turn(0, text("carry on"), "Done: shipped it.").log();
    const loud = new History().turn(0, text(KEEP_WARM), "I restarted the deploy.").log();
    const lookup = (id: string) => ({ a, b, loud })[id] ?? null;
    const mixed = new History().turn(3_000, report([{ id: "a" }, { id: "b" }]), "ok", "completed", "system").log();
    expect(isKeeperTurn("mixed", mixed.turns[0]!, lookup)).toBe(false);
    const both = new History().turn(3_000, report([{ id: "a" }, { id: "loud" }]), "ok", "completed", "system").log();
    expect(isKeeperTurn("both", both.turns[0]!, lookup)).toBe(true);
    expect(broughtNothingNew("both", both.turns[0]!, lookup)).toBe(false);
    expect(originsOf("p", both.turns[0]!, lookup).map((o) => o.threadId)).toEqual(["a", "loud"]);
  });

  it("makes a turn real when you type into it, when a child failed, or when nothing sent it", () => {
    const child = new History().turn(0, text(KEEP_WARM), NOT_FINISHED).log();
    const lookup = (id: string) => (id === "c" ? child : null);

    const steered = new History();
    steered.turn(0, text(KEEP_WARM), NOT_FINISHED);
    // A message typed while the keep-warm's turn runs is taken by the same turn.
    const id = steered.request(400, text("also, rename the file"));
    const typed = steered.events.pop()!;
    steered.events.splice(3, 0, typed, { seq: 0, type: "turn/input/accepted", createdAt: 400, data: { clientRequestId: id } });
    steered.events.forEach((e, i) => (e.seq = i + 1));
    expect(steered.log().turns[0]!.inputs.map((i) => i.kind)).toEqual(["sent", "other"]);
    expect(isKeeperTurn("steered", steered.log().turns[0]!, lookup)).toBe(false);

    const failed = new History().turn(3_000, report([{ id: "c", status: "failed" }]), "ok", "completed", "system").log();
    expect(isKeeperTurn("failed", failed.turns[0]!, lookup)).toBe(false);
    expect(isKeeperTurn("woken", new History().wake(0).log().turns[0]!, lookup)).toBe(false);
  });

  it("takes a report that arrives late as real when a real turn of the child may be behind it", () => {
    // The child's real turn ended at 1 s; its report was held until after a keep-warm turn at 60 s.
    const child = new History().turn(0, text("carry on"), "Shipped it.").turn(60_000, text(KEEP_WARM), NOT_FINISHED).log();
    const late = new History().turn(90_000, report([{ id: "c" }]), "ok", "completed", "system").log();
    const lookup = (id: string) => (id === "c" ? child : late);
    expect(isKeeperTurn("p", late.turns[0]!, lookup)).toBe(false);

    // Once a report of the real turn was delivered, the next one stands for the keep-warm alone.
    const onTime = new History().turn(3_000, report([{ id: "c" }]), "ok", "completed", "system").turn(63_000, report([{ id: "c" }]), "ok", "completed", "system").log();
    const lookup2 = (id: string) => (id === "c" ? child : onTime);
    expect(isKeeperTurn("p", onTime.turns[0]!, lookup2)).toBe(false);
    expect(isKeeperTurn("p", onTime.turns[1]!, lookup2)).toBe(true);
  });

  it("does not take a check-in whose reply found something as nothing new", () => {
    const sent = checkInText([{ kind: "command", reason: "stalled", id: "b1", description: "x", startedAt: 0, silentMs: 0, runningMs: 0, outputFile: "/o" }]);
    const found = new History().turn(0, text(sent), "b1 was stuck on a prompt; I answered it.").log();
    const fine = new History().turn(0, text(sent), "Checked b1, still running normally, nothing new. Nothing needed from you.").log();
    expect(isKeeperTurn("found", found.turns[0]!, () => null)).toBe(true);
    expect(broughtNothingNew("found", found.turns[0]!, () => null)).toBe(false);
    expect(broughtNothingNew("fine", fine.turns[0]!, () => null)).toBe(true);
  });

  it("reads on from where it stopped, so a restart attributes the same way", () => {
    const h = new History().turn(0, text(KEEP_WARM), NOT_FINISHED).turn(10_000, text("thanks"), "sure");
    const whole = h.log();
    const first = foldTurns(emptyTurnLog(), h.events.slice(0, 3));
    const resumed = foldTurns(JSON.parse(JSON.stringify(first)) as TurnLog, h.events);
    expect(resumed).toEqual(whole);
  });
});

describe("reports on their way", () => {
  it("holds the parent waiting from the child's turn ending until the report is delivered, at most two minutes", () => {
    const child = new History().turn(0, text(KEEP_WARM), NOT_FINISHED).log();
    const ended = child.turns[0]!.endedAt!;
    expect(reportPending(emptyTurnLog(), "c", child, ended + 1_000)).toBe(true);
    expect(reportPending(emptyTurnLog(), "c", child, ended + 120_000)).toBe(false);
    const parent = new History().turn(ended + 2_000, report([{ id: "c" }]), "ok", "completed", "system").log();
    expect(reportPending(parent, "c", child, ended + 3_000)).toBe(false);
  });
});
