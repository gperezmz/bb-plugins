// The steps that change the thread records a window holds: an answer made
// before a signal cannot put back what the signal replaced, a full answer
// replaces what was held, and a signal from another epoch asks for one.
import { describe, expect, it } from "vitest";
import { makeThread } from "../testing/fixtures";
import { applyFetched, applySignal, applySync, NO_RECORDS, threadsToFetch } from "./records";

const done = (text: string) => ({ done: { kind: "done" as const, text, at: 1 } });
const full = (revision: number, records: Parameters<typeof applySync>[1]["records"], epoch = "e1") =>
  ({ epoch, revision, full: true, records });

describe("thread records a window holds", () => {
  it("keeps a signal's record over an answer made before it", () => {
    let held = applySync(NO_RECORDS, full(1, { a: { stamps: { startedAt: 1 }, notes: null } }));
    held = applySignal(held, { epoch: "e1", revision: 3, records: { a: { stamps: { startedAt: 3 }, notes: done("new") } } })!;
    held = applySync(held, { epoch: "e1", revision: 2, full: false, records: { a: { stamps: { startedAt: 2 }, notes: done("old") } } });
    expect(held.stamps.startedAt).toEqual({ a: 3 });
    expect(held.notes).toEqual({ a: done("new") });
    expect(held.point).toEqual({ epoch: "e1", revision: 3 });
  });

  it("drops a thread whose record comes back empty", () => {
    let held = applySync(NO_RECORDS, full(1, { a: { stamps: { seenAt: 1 }, notes: done("x") } }));
    held = applySignal(held, { epoch: "e1", revision: 2, records: { a: { stamps: null, notes: null } } })!;
    expect(held.stamps.seenAt).toEqual({});
    expect(held.notes).toEqual({});
  });

  it("replaces everything on a full answer, keeping what came later by signal", () => {
    let held = applySync(NO_RECORDS, full(1, { a: { stamps: { seenAt: 1 }, notes: null }, b: { stamps: { seenAt: 1 }, notes: null } }));
    held = applySignal(held, { epoch: "e1", revision: 5, records: { c: { stamps: { seenAt: 5 }, notes: null } } })!;
    held = applySync(held, full(4, { a: { stamps: { seenAt: 4 }, notes: null } }));
    expect(held.stamps.seenAt).toEqual({ a: 4, c: 5 });
  });

  it("asks for a full sync on a signal from another epoch", () => {
    const held = applySync(NO_RECORDS, full(1, {}));
    expect(applySignal(held, { epoch: "e2", revision: 1, records: {} })).toBeNull();
  });

  it("fetches each thread without a record once, and none created since the window went live", () => {
    const threads = [makeThread({ id: "a", createdAt: 10 }), makeThread({ id: "b", createdAt: 10 }), makeThread({ id: "new", createdAt: 100 })];
    const held = applySync(NO_RECORDS, full(1, { a: { stamps: { seenAt: 1 }, notes: null } }));
    expect(threadsToFetch(held, threads, 50)).toEqual(["b"]);
    const fetched = applyFetched(held, ["b"], { epoch: "e1", revision: 1, records: {} });
    expect(threadsToFetch(fetched, threads, 50)).toEqual([]);
  });
});
