import { describe, expect, it } from "vitest";
import { createSdkThreads, toTurnRecord } from "./threads";

type Row = Parameters<typeof toTurnRecord>[0];

const requested = (createdAt: number, data: Record<string, unknown>, seq = createdAt) =>
  ({ id: `r${seq}`, seq, threadId: "t", scope: { kind: "thread" }, type: "client/turn/requested", createdAt, data }) as unknown as Row;
const completed = (createdAt: number, status: string, seq = createdAt) =>
  ({ id: `c${seq}`, seq, threadId: "t", scope: { kind: "thread" }, type: "turn/completed", createdAt, data: { status } }) as unknown as Row;

describe("toTurnRecord", () => {
  it("reads a request as the user's only for a message told with no sender thread and no retry, never a spawn", () => {
    expect(toTurnRecord(requested(5, { source: "tell", initiator: "user", senderThreadId: null }))).toEqual({ kind: "requested", at: 5, byUser: true });
    expect(toTurnRecord(requested(5, { initiator: "user", senderThreadId: "thr_agent" }))).toMatchObject({ byUser: false });
    expect(toTurnRecord(requested(5, { source: "tell", initiator: "agent", senderThreadId: "thr_agent" }))).toMatchObject({ byUser: false });
    // bb records an agent's spawn just as it would the user's: initiator "user", no sender.
    expect(toTurnRecord(requested(5, { source: "spawn", initiator: "user", senderThreadId: null, target: { kind: "thread-start" } }))).toMatchObject({ byUser: false });
    expect(toTurnRecord(requested(5, { initiator: "system", senderThreadId: null }))).toMatchObject({ byUser: false });
    expect(toTurnRecord(requested(5, { source: "tell", initiator: "user", senderThreadId: null, retryAttempt: 1 }))).toMatchObject({ byUser: false });
  });

  it("reads how a turn ended", () => {
    expect(toTurnRecord(completed(7, "interrupted"))).toEqual({ kind: "ended", at: 7, outcome: "interrupted" });
    expect(toTurnRecord(completed(7, "failed"))).toEqual({ kind: "ended", at: 7, outcome: "failed" });
  });
});

describe("turnsSince", () => {
  it("pages back through bb's turn events, newest first, until one from before the time", async () => {
    const all = [completed(30, "completed", 6), requested(25, { source: "tell", initiator: "user", senderThreadId: null }, 5), completed(20, "interrupted", 4), requested(10, { initiator: "agent", senderThreadId: "a" }, 3)];
    const asked: unknown[] = [];
    const sdk = {
      threads: {
        events: {
          // bb answers at most two rows a page, below the limit asked for.
          async list(args: { beforeSeq?: string }) {
            asked.push(args.beforeSeq);
            const from = args.beforeSeq === undefined ? all : all.filter((row) => row.seq < Number(args.beforeSeq));
            return from.slice(0, 2);
          },
        },
      },
    };
    const turns = await createSdkThreads({ sdk } as never).turnsSince("t", 15);
    expect(turns).toEqual([
      { kind: "ended", at: 30, outcome: "completed" },
      { kind: "requested", at: 25, byUser: true },
      { kind: "ended", at: 20, outcome: "interrupted" },
    ]);
    expect(asked).toEqual([undefined, "5"]);
  });
});
