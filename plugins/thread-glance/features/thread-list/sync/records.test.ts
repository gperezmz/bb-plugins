// The held thread records: a sync answer, a records signal, and the revisions
// that stop an older answer putting back what a later signal replaced.
import { describe, expect, it } from "vitest";
import { parkedRow, settledRow, type LifecycleRow } from "@/shared/lifecycle";
import { applySignal, applySync, NO_RECORDS, recordsFromCache } from "./records";

const rec = (lifecycle: LifecycleRow | null) => ({ lifecycle });
const answer = (revision: number, records: Record<string, ReturnType<typeof rec>>, full = true, epoch = "e1") => ({ epoch, revision, full, records });

describe("sync answers", () => {
  it("a full answer replaces what was held and names the point", () => {
    const first = applySync(NO_RECORDS, answer(3, { a: rec(parkedRow(1)), b: rec(settledRow(2, "auto")) }));
    expect(Object.keys(first.lifecycle).sort()).toEqual(["a", "b"]);
    expect(first.point).toEqual({ epoch: "e1", revision: 3 });
    const second = applySync(first, answer(5, { b: rec(settledRow(2, "auto")) }));
    expect(Object.keys(second.lifecycle)).toEqual(["b"]);
    expect(second.lifecycle.b).toBe(first.lifecycle.b);
  });

  it("a delta changes only what it names, and a null record deletes the row", () => {
    const held = applySync(NO_RECORDS, answer(3, { a: rec(parkedRow(1)), b: rec(parkedRow(2)) }));
    const next = applySync(held, answer(4, { a: rec(null) }, false));
    expect(Object.keys(next.lifecycle)).toEqual(["b"]);
    expect(next.point!.revision).toBe(4);
  });

  it("a new epoch is a full replacement", () => {
    const held = applySync(NO_RECORDS, answer(9, { a: rec(parkedRow(1)) }));
    const next = applySync(held, answer(1, { b: rec(parkedRow(2)) }, true, "e2"));
    expect(Object.keys(next.lifecycle)).toEqual(["b"]);
    expect(next.point).toEqual({ epoch: "e2", revision: 1 });
  });

  it("keeps a record that came by signal after the answer was made", () => {
    let held = applySync(NO_RECORDS, answer(3, { a: rec(parkedRow(1)) }));
    held = applySignal(held, { epoch: "e1", revision: 6, records: { a: rec(null), c: rec(parkedRow(6)) } })!;
    const next = applySync(held, answer(5, { a: rec(parkedRow(1)) }));
    expect(Object.keys(next.lifecycle)).toEqual(["c"]);
    expect(next.point!.revision).toBe(6);
  });
});

describe("records signals", () => {
  it("applies a newer record and ignores an older one", () => {
    const held = applySync(NO_RECORDS, answer(5, { a: rec(parkedRow(1)) }));
    const newer = applySignal(held, { epoch: "e1", revision: 6, records: { a: rec(settledRow(9, "manual")) } })!;
    expect(newer.lifecycle.a!.settledAt).toBe(9);
    const older = applySignal(newer, { epoch: "e1", revision: 4, records: { a: rec(parkedRow(1)) } })!;
    expect(older.lifecycle.a!.settledAt).toBe(9);
    expect(older.point!.revision).toBe(6);
  });

  it("is refused from another epoch, which only a full sync settles", () => {
    const held = applySync(NO_RECORDS, answer(5, {}));
    expect(applySignal(held, { epoch: "e2", revision: 1, records: {} })).toBeNull();
    expect(applySignal(NO_RECORDS, { epoch: "e2", revision: 1, records: {} })).toBe(NO_RECORDS);
  });

  it("keeps the held object for a record that did not change", () => {
    const row = parkedRow(1);
    const held = applySync(NO_RECORDS, answer(5, { a: rec(row) }));
    const next = applySignal(held, { epoch: "e1", revision: 6, records: { a: rec({ ...row }) } })!;
    expect(next.lifecycle.a).toBe(row);
  });
});

describe("rows cached in the browser", () => {
  it("are shown without a point, so the first answer replaces them whole", () => {
    const cached = recordsFromCache({ a: parkedRow(1) });
    expect(cached.point).toBeNull();
    const next = applySync(cached, answer(2, { b: rec(parkedRow(2)) }));
    expect(Object.keys(next.lifecycle)).toEqual(["b"]);
  });
});
