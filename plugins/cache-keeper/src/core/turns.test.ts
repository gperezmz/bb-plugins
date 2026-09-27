import type { PluginBbSdk } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { checkInText, keepWarmText } from "./messages";
import { classifyQueued, emptyTurnLog, foldTurns, isKeeperTurn, broughtNothingNew, originsOf, reportPending, type BbEvent, type ThreadContext, type Turn, type TurnLog } from "./turns";

const clock = () => "14:30";
const KEEP_WARM = keepWarmText([{ kind: "command", id: "b1", description: "deploy", startedAt: 0 }], [], clock);
const NOT_FINISHED = 'Not finished yet, still waiting on background command b1 ("deploy"). Nothing needed from you.';

/** The fields of bb's `client/turn/requested` event that say who sent a request and what it reports, from the SDK's `threadEventSchema`. */
type Request = Pick<
  Extract<Awaited<ReturnType<PluginBbSdk["threads"]["events"]["list"]>>[number], { type: "client/turn/requested" }>["data"],
  "initiator" | "input" | "systemMessageKind" | "systemMessageSubject"
>;
type Kind = NonNullable<Request["systemMessageKind"]>;

/** Builds a thread's events the way bb 0.44 writes them. */
class History {
  events: BbEvent[] = [];
  warnings: string[] = [];
  private seq = 0;
  private req = 0;
  /** The thread's children, one level down; every thread is when not given. */
  constructor(private readonly children: string[] | null = null) {}
  private push(type: string, at: number, data: unknown) {
    this.events.push({ seq: ++this.seq, type, createdAt: at, data });
  }
  /** A request, then a turn that takes it and replies; a bare input is one you typed. */
  turn(at: number, request: Request | unknown[], reply: string, status = "completed") {
    const id = this.request(at, request);
    this.push("turn/started", at + 100, {});
    this.push("turn/input/accepted", at + 100, { clientRequestId: id });
    this.push("item/completed", at + 500, { item: { type: "agentMessage", id: "m", text: reply } });
    this.push("turn/completed", at + 1000, { status });
    return this;
  }
  request(at: number, request: Request | unknown[]) {
    const id = `creq_${++this.req}`;
    const fields = Array.isArray(request) ? { initiator: "user", input: request } : request;
    this.push("client/turn/requested", at, { requestId: id, ...fields, target: { kind: "new-turn" } });
    return id;
  }
  /** A turn with no input: Claude Code woken by a background task finishing. */
  wake(at: number) {
    this.push("turn/started", at, {});
    this.push("turn/completed", at + 1000, { status: "completed" });
    return this;
  }
  context(): ThreadContext {
    return { threadId: "t", isChild: (id) => this.children?.includes(id) ?? true, warn: (m) => this.warnings.push(m) };
  }
  log(): TurnLog {
    return foldTurns(emptyTurnLog(), this.events, this.context());
  }
}

const text = (t: string): Request["input"] => [{ type: "text", text: t, mentions: [] }];

const KIND_OF: Record<string, Kind> = { completed: "child-completed", failed: "child-failed", interrupted: "child-interrupted", "needs-attention": "child-needs-attention" };

/** bb's report of one child's turn, or a batch naming several, as bb 0.44 requests it. */
function report(children: { id: string; status?: string }[], reply = NOT_FINISHED): Request {
  if (children.length === 1) {
    const c = children[0]!;
    const mention = `@thread:${c.id}`;
    const body = `[bb system]\n\n${mention} ${c.status ?? "completed"}:\n\n${reply}`;
    return {
      initiator: "system",
      systemMessageKind: KIND_OF[c.status ?? "completed"],
      systemMessageSubject: { kind: "thread", threadId: c.id, threadName: c.id },
      input: [{ type: "text", text: body, mentions: [{ start: 13, end: 13 + mention.length, resource: { kind: "thread", threadId: c.id, label: "c" } }] }],
    };
  }
  let body = "[bb system]\n\nChild thread updates:\n\n";
  const mentions: { start: number; end: number; resource: { kind: "thread"; threadId: string; label: string } }[] = [];
  children.forEach((c, i) => {
    if (i > 0) body += "\n";
    body += "- ";
    const mention = `@thread:${c.id}`;
    mentions.push({ start: body.length, end: body.length + mention.length, resource: { kind: "thread", threadId: c.id, label: c.id } });
    body += `${mention} ${c.status ?? "completed"}.`;
  });
  return { initiator: "system", systemMessageKind: "child-outcome-batch", systemMessageSubject: { kind: "thread-batch", count: children.length }, input: [{ type: "text", text: body, mentions }] };
}

describe("turn attribution", () => {
  it("counts a keep-warm turn and the parent's report of it as Cache Keeper's, bringing nothing new", () => {
    const child = new History().turn(1_000, text("BACKGROUND please"), "Started it.").turn(300_000, text(KEEP_WARM), NOT_FINISHED).log();
    // bb reported the child's first turn too, when it ended.
    const parent = new History().turn(3_000, report([{ id: "c" }], "Started it."), "ok").turn(302_000, report([{ id: "c" }]), "Noted.").log();
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
    const mid = new History().turn(3_000, report([{ id: "leaf" }]), "ok").log();
    const top = new History().turn(6_000, report([{ id: "mid" }]), "ok").log();
    const lookup = (id: string) => ({ leaf, mid, top })[id] ?? null;
    expect(isKeeperTurn("top", top.turns[0]!, lookup)).toBe(true);
    expect(originsOf("top", top.turns[0]!, lookup).map((o) => o.threadId)).toEqual(["leaf"]);
  });

  it("makes a batch real when any child turn in it was real, and nothing new only when every child brought nothing new", () => {
    const a = new History().turn(0, text(KEEP_WARM), NOT_FINISHED).log();
    const b = new History().turn(0, text("carry on"), "Done: shipped it.").log();
    const loud = new History().turn(0, text(KEEP_WARM), "I restarted the deploy.").log();
    const lookup = (id: string) => ({ a, b, loud })[id] ?? null;
    const mixed = new History().turn(3_000, report([{ id: "a" }, { id: "b" }]), "ok").log();
    expect(isKeeperTurn("mixed", mixed.turns[0]!, lookup)).toBe(false);
    const both = new History().turn(3_000, report([{ id: "a" }, { id: "loud" }]), "ok").log();
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

    const failed = new History().turn(3_000, report([{ id: "c", status: "failed" }]), "ok").log();
    expect(isKeeperTurn("failed", failed.turns[0]!, lookup)).toBe(false);
    expect(isKeeperTurn("woken", new History().wake(0).log().turns[0]!, lookup)).toBe(false);
  });

  it("takes a report that arrives late as real when a real turn of the child may be behind it", () => {
    // The child's real turn ended at 1 s; its report was held until after a keep-warm turn at 60 s.
    const child = new History().turn(0, text("carry on"), "Shipped it.").turn(60_000, text(KEEP_WARM), NOT_FINISHED).log();
    const late = new History().turn(90_000, report([{ id: "c" }]), "ok").log();
    const lookup = (id: string) => (id === "c" ? child : late);
    expect(isKeeperTurn("p", late.turns[0]!, lookup)).toBe(false);

    // Once a report of the real turn was delivered, the next one stands for the keep-warm alone.
    const onTime = new History().turn(3_000, report([{ id: "c" }]), "ok").turn(63_000, report([{ id: "c" }]), "ok").log();
    const lookup2 = (id: string) => (id === "c" ? child : onTime);
    expect(isKeeperTurn("p", onTime.turns[0]!, lookup2)).toBe(false);
    expect(isKeeperTurn("p", onTime.turns[1]!, lookup2)).toBe(true);
  });

  it("makes a keep-warm turn real when a background task finishes during it", () => {
    const h = new History().turn(0, text(KEEP_WARM), NOT_FINISHED);
    // bb records the task finishing while the turn runs; Claude Code takes it into the same turn.
    h.events.splice(3, 0, { seq: 0, type: "item/backgroundTask/completed", createdAt: 300, data: { item: { type: "backgroundTask", familyId: "b1" } } });
    h.events.forEach((e, i) => (e.seq = i + 1));
    expect(isKeeperTurn("t", h.log().turns[0]!, () => null)).toBe(false);
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
    const first = foldTurns(emptyTurnLog(), h.events.slice(0, 3), h.context());
    const resumed = foldTurns(JSON.parse(JSON.stringify(first)) as TurnLog, h.events, h.context());
    expect(resumed).toEqual(whole);
  });
});

describe("recognising bb's reports", () => {
  /** A child whose one turn was a keep-warm that brought nothing new, ending as `status` says. */
  const quietChild = (status = "completed") => new History().turn(0, text(KEEP_WARM), NOT_FINISHED, status).log();
  const parentOf = (request: Request | unknown[], children: string[] | null = null) => {
    const h = new History(children).turn(3_000, request, "ok");
    const log = h.log();
    return { h, log, turn: log.turns[0]! };
  };

  it("takes each of the five child kinds by its kind", () => {
    const c = quietChild();
    const lookup = (id: string) => (id === "c" ? c : null);
    for (const [status, keeper] of [["completed", true], ["failed", false], ["interrupted", false], ["needs-attention", false]] as const) {
      const { turn } = parentOf(report([{ id: "c", status }]));
      expect(turn.inputs[0]!.kind, status).toBe("report");
      expect(isKeeperTurn("p", turn, lookup), status).toBe(keeper);
    }
    const d = quietChild();
    const { turn: batch } = parentOf(report([{ id: "c" }, { id: "d" }]));
    const both = (id: string) => ({ c, d })[id] ?? null;
    expect(isKeeperTurn("p", batch, both)).toBe(true);
    expect(broughtNothingNew("p", batch, both)).toBe(true);
  });

  it("judges each line of a batch by its child's own turn, whatever the batch's text says", () => {
    const ok = quietChild();
    const failed = quietChild("failed");
    // bb's text says both completed; the child's history says one failed.
    const { turn } = parentOf(report([{ id: "ok" }, { id: "failed" }]));
    const lookup = (id: string) => ({ ok, failed })[id] ?? null;
    expect(isKeeperTurn("p", turn, lookup)).toBe(false);
    // And a batch whose text says one failed holds when every child's turn completed.
    const { turn: worded } = parentOf(report([{ id: "ok" }, { id: "also", status: "failed" }]));
    expect(isKeeperTurn("p", worded, (id) => ({ ok, also: quietChild() })[id] ?? null)).toBe(true);
  });

  it("makes a child-completed report real when the child's own turn did not complete", () => {
    const c = quietChild("interrupted");
    const { turn } = parentOf(report([{ id: "c" }]));
    expect(isKeeperTurn("p", turn, (id) => (id === "c" ? c : null))).toBe(false);
  });

  it("takes a report without the [bb system] prefix as a report", () => {
    const c = quietChild();
    const r = report([{ id: "c" }]);
    const block = r.input[0] as { text: string };
    block.text = block.text.replace("[bb system]", "[bb]");
    const { turn } = parentOf(r);
    expect(turn.inputs[0]!.kind).toBe("report");
    expect(isKeeperTurn("p", turn, (id) => (id === "c" ? c : null))).toBe(true);
  });

  it("takes a system message of another kind as other input, though it starts [bb system] and mentions a child", () => {
    const c = quietChild();
    for (const kind of ["ownership-assigned", "ownership-removed", "tool-result-delivered", "unlabeled"] as const) {
      const { h, turn } = parentOf({ ...report([{ id: "c" }]), systemMessageKind: kind });
      expect(turn.inputs, kind).toEqual([{ kind: "other" }]);
      expect(isKeeperTurn("p", turn, (id) => (id === "c" ? c : null))).toBe(false);
      expect(h.warnings).toEqual([]);
    }
  });

  it("takes a system message mentioning a thread with no kind, or an unknown one, as other input and warns", () => {
    const { systemMessageKind: _, ...kindless } = report([{ id: "c" }]);
    const none = parentOf(kindless);
    expect(none.turn.inputs).toEqual([{ kind: "other" }]);
    expect(none.h.warnings).toEqual(['request creq_1 into t: a system message mentioning a thread has no systemMessageKind; it is not read as a report']);
    // A kind bb might add later, which the SDK does not type yet.
    const unknown = parentOf({ ...report([{ id: "c" }]), systemMessageKind: "child-paused" as Kind });
    expect(unknown.turn.inputs).toEqual([{ kind: "other" }]);
    expect(unknown.h.warnings).toEqual(['request creq_1 into t: a system message mentioning a thread has the unknown systemMessageKind "child-paused"; it is not read as a report']);
    // A system message that mentions no thread is not a report gone missing.
    const retry = parentOf({ initiator: "system", input: text("Please continue.") });
    expect(retry.turn.inputs).toEqual([{ kind: "other" }]);
    expect(retry.h.warnings).toEqual([]);
  });

  it("still recognises Cache Keeper's own message by its text, whoever bb says sent it", () => {
    const { turn } = parentOf({ initiator: "system", input: text(KEEP_WARM) });
    expect(turn.inputs).toEqual([{ kind: "sent", text: KEEP_WARM.trim(), at: 3_000 }]);
  });

  it("warns once for each input of a request that has several", () => {
    const { systemMessageKind: _, ...kindless } = report([{ id: "c" }]);
    const h = new History();
    h.events.push({ seq: 1, type: "client/turn/requested", createdAt: 0, data: { requestId: "creq_9", ...kindless, inputGroups: [kindless.input, kindless.input] } });
    h.log();
    expect(h.warnings.map((w) => w.split(":")[0])).toEqual(["request creq_9 (input 1) into t", "request creq_9 (input 2) into t"]);
  });

  it("makes a report naming no child real and warns: a single one without a subject, or a batch mentioning no child", () => {
    const c = quietChild();
    const lookup = (id: string) => (id === "c" ? c : null);
    const single = parentOf({ ...report([{ id: "c" }]), systemMessageSubject: null });
    expect(single.turn.inputs).toEqual([{ kind: "other" }]);
    expect(isKeeperTurn("p", single.turn, lookup)).toBe(false);
    expect(single.h.warnings).toEqual(["request creq_1 into t: bb's child-completed report names no child thread; its turn counts as real"]);

    const batch = parentOf(report([{ id: "x" }, { id: "y" }]), ["c"]);
    expect(batch.turn.inputs).toEqual([{ kind: "other" }]);
    expect(batch.h.warnings).toEqual(["request creq_1 into t: bb's child-outcome-batch report names no child thread; its turn counts as real"]);

    // A batch naming a child beside another thread names the child alone.
    const mixed = parentOf(report([{ id: "c" }, { id: "x" }]), ["c"]);
    expect(mixed.turn.inputs).toEqual([{ kind: "report", report: "child-outcome-batch", at: 3_000, lines: [{ childId: "c" }] }]);
    expect(isKeeperTurn("p", mixed.turn, lookup)).toBe(true);
    expect(mixed.h.warnings).toEqual([]);
  });

  it("reads report lines stored before reports had a kind as it did", () => {
    const c = quietChild();
    const lookup = (id: string) => (id === "c" ? c : null);
    const stored = (completed: boolean): Turn => ({
      startSeq: 1,
      startedAt: 3_000,
      endedAt: 4_000,
      status: "completed",
      reply: "ok",
      inputs: [{ kind: "report", at: 3_000, lines: [{ childId: "c", completed }] }],
    });
    expect(isKeeperTurn("p", stored(true), lookup)).toBe(true);
    expect(broughtNothingNew("p", stored(true), lookup)).toBe(true);
    expect(isKeeperTurn("p", stored(false), lookup)).toBe(false);
    // A stored completed line is judged by the child's own turn.
    expect(isKeeperTurn("p", stored(true), () => quietChild("failed"))).toBe(false);
  });
});

describe("queued report rows", () => {
  const row = (content: unknown[], over: { system?: boolean; failed?: boolean } = {}) => ({ createdAt: 5_000, failed: false, system: true, content, ...over });
  const isChild = (id: string) => id === "c";

  it("takes a system row starting [bb system] and mentioning a child as a report of that child alone", () => {
    const content = report([{ id: "c" }, { id: "x" }]).input;
    expect(classifyQueued(row(content), isChild)).toEqual({ kind: "report", at: 5_000, lines: [{ childId: "c" }] });
    expect(classifyQueued(row(content, { failed: true }), isChild)).toEqual({ kind: "other" });
    expect(classifyQueued(row(content, { system: false }), isChild)).toEqual({ kind: "other" });
    expect(classifyQueued(row(text("[bb system]\n\nnothing mentioned")), isChild)).toEqual({ kind: "other" });
  });

  it("does not take a system row without the [bb system] prefix as a report, whatever it mentions", () => {
    const content = report([{ id: "c" }]).input as { text: string }[];
    content[0]!.text = content[0]!.text.replace("[bb system]", "[bb]");
    expect(classifyQueued(row(content), isChild)).toEqual({ kind: "other" });
  });
});

describe("reports on their way", () => {
  it("holds the parent waiting from the child's turn ending until the report is delivered, at most two minutes", () => {
    const child = new History().turn(0, text(KEEP_WARM), NOT_FINISHED).log();
    const ended = child.turns[0]!.endedAt!;
    expect(reportPending(emptyTurnLog(), "c", child, ended + 1_000)).toBe(true);
    expect(reportPending(emptyTurnLog(), "c", child, ended + 120_000)).toBe(false);
    const parent = new History().turn(ended + 2_000, report([{ id: "c" }]), "ok").log();
    expect(reportPending(parent, "c", child, ended + 3_000)).toBe(false);
  });
});
