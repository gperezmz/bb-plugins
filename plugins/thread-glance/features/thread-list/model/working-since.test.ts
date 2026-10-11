import { describe, expect, it } from "vitest";
import { MAX_WORKING_STAMPS, NO_STAMPS, observeWorking, readWorkingStamps, WORKING_CONFIRM_MS, WORKING_PAUSE_MS } from "./working-since";

const NOW = 1_700_000_000_000;

describe("observeWorking", () => {
  it("stamps a thread at its first sight working and keeps the stamp", () => {
    const first = observeWorking(NO_STAMPS, ["a"], NOW);
    expect(first.a).toEqual({ since: NOW, seenAt: NOW });
    expect(observeWorking(first, ["a"], NOW + 1_000)).toBe(first);
  });

  it("confirms a stamp once a minute without moving its start", () => {
    const first = observeWorking(NO_STAMPS, ["a"], NOW);
    const later = observeWorking(first, ["a"], NOW + WORKING_CONFIRM_MS);
    expect(later.a).toEqual({ since: NOW, seenAt: NOW + WORKING_CONFIRM_MS });
  });

  it("clears the stamp of a thread seen idle, so its next work starts fresh", () => {
    const first = observeWorking(NO_STAMPS, ["a", "b"], NOW);
    const idle = observeWorking(first, ["b"], NOW + 1_000);
    expect(Object.keys(idle)).toEqual(["b"]);
    expect(observeWorking(idle, ["a", "b"], NOW + 2_000).a.since).toBe(NOW + 2_000);
  });

  it("starts a fresh stamp after a pause, such as a window closed for a while", () => {
    const first = observeWorking(NO_STAMPS, ["a"], NOW);
    const after = observeWorking(first, ["a"], NOW + WORKING_PAUSE_MS + 1);
    expect(after.a.since).toBe(NOW + WORKING_PAUSE_MS + 1);
  });

  it("keeps a bounded number", () => {
    const ids = Array.from({ length: MAX_WORKING_STAMPS + 20 }, (_, index) => `t${index}`);
    expect(Object.keys(observeWorking(NO_STAMPS, ids, NOW))).toHaveLength(MAX_WORKING_STAMPS);
  });
});

describe("readWorkingStamps", () => {
  it("reads what was stored and ignores what is malformed", () => {
    expect(readWorkingStamps({ a: { since: 1, seenAt: 2 }, b: { since: "x" }, c: null, d: 4 })).toEqual({ a: { since: 1, seenAt: 2 } });
    expect(readWorkingStamps(null)).toEqual({});
    expect(readWorkingStamps([1])).toEqual({});
  });
});
