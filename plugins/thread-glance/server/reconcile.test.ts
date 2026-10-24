import { describe, expect, it } from "vitest";
import { parkedRow } from "../shared/lifecycle";
import { createLifecycleStore } from "./lifecycle-store";
import { createOrderStore } from "./order-store";
import { reconcileState } from "./reconcile";
import { memoryDatabase } from "./testing/fakes";

const thread = (id: string, overrides: Partial<Parameters<typeof reconcileState>[1][number]> = {}) => ({
  id,
  hidden: false,
  parentThreadId: null,
  hasPendingInteraction: false,
  latestAttentionAt: 1_000,
  createdAt: 1_000,
  ...overrides,
});

function stores() {
  const db = memoryDatabase();
  return { lifecycle: createLifecycleStore(db), order: createOrderStore(db) };
}

describe("reconcileState and a waiting question", () => {
  it("clears a mark that attention made stale", () => {
    const s = stores();
    s.lifecycle.putMany([["root", parkedRow(5_000)]]);
    reconcileState(s, [thread("root", { latestAttentionAt: 9_000 })], new Set());
    expect(s.lifecycle.get("root")).toBeNull();
  });

  it("sets the attention aside instead while a question waits below, and clears the mark once it is answered and new attention comes", () => {
    const s = stores();
    s.lifecycle.putMany([["root", parkedRow(5_000)]]);
    const asking = [thread("root", { latestAttentionAt: 9_000 }), thread("kid", { parentThreadId: "root", hasPendingInteraction: true })];
    const result = reconcileState(s, asking, new Set());
    expect(result.rows).toEqual(["root"]);
    expect(s.lifecycle.get("root")).toEqual({ ...parkedRow(5_000), heldAttentionAt: 9_000 });

    reconcileState(s, [thread("root", { latestAttentionAt: 9_000 }), thread("kid", { parentThreadId: "root" })], new Set());
    expect(s.lifecycle.get("root")).toEqual({ ...parkedRow(5_000), heldAttentionAt: 9_000 });
    reconcileState(s, [thread("root", { latestAttentionAt: 12_000 }), thread("kid", { parentThreadId: "root" })], new Set());
    expect(s.lifecycle.get("root")).toBeNull();
  });

  it("does not hold for a root whose own question is the attention, or for a hidden asker", () => {
    const s = stores();
    s.lifecycle.putMany([["root", parkedRow(5_000)]]);
    reconcileState(s, [thread("root", { latestAttentionAt: 9_000, hasPendingInteraction: true }), thread("kid", { parentThreadId: "root", hasPendingInteraction: true })], new Set());
    expect(s.lifecycle.get("root")).toBeNull();
    s.lifecycle.putMany([["root", parkedRow(5_000)]]);
    reconcileState(s, [thread("root", { latestAttentionAt: 9_000 }), thread("kid", { parentThreadId: "root", hasPendingInteraction: true, hidden: true })], new Set());
    expect(s.lifecycle.get("root")).toBeNull();
  });
});
