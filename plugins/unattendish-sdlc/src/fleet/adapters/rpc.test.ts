import { describe, expect, it } from "vitest";
import type { DashboardApi } from "../application/views";
import { MAX_ANSWER_BYTES, rpcHandlers } from "./rpc";

const api = (over: Partial<DashboardApi>): DashboardApi => new Proxy(over as DashboardApi, { get: (target, name) => (target as never)[name] ?? (() => Promise.reject(new Error(`${String(name)} called`))) });

describe("rpcHandlers", () => {
  it("hands each call to the use case of the same name with its input", async () => {
    const seen: unknown[] = [];
    const handlers = rpcHandlers(api({ threadFleet: async (input) => (seen.push(input), { kind: "none", holder: null }) }));
    expect(await handlers.threadFleet({ threadId: "thr_a" })).toEqual({ kind: "none", holder: null });
    expect(seen).toEqual([{ threadId: "thr_a" }]);
  });

  it("passes a ledger filter on only when one was given", async () => {
    const seen: unknown[] = [];
    const handlers = rpcHandlers(api({ ledger: async (input) => (seen.push(input), { ok: false, reason: "x" }) }));
    await handlers.ledger({ repo: "r" });
    await handlers.ledger({ repo: "r", filter: { item: "#1" } });
    expect(seen).toEqual([{ repo: "r" }, { repo: "r", filter: { item: "#1" } }]);
  });

  it("refuses an answer that would not fit the wire", async () => {
    const huge = { ok: true as const, ledger: { generatedAt: "", changes: [], dropped: [], wakes: [], padding: "x".repeat(MAX_ANSWER_BYTES) } };
    const handlers = rpcHandlers(api({ ledger: async () => huge }));
    await expect(handlers.ledger({ repo: "r" })).rejects.toThrow("too large");
  });

  it("measures an answer in bytes, not characters", async () => {
    const wide = { ok: false as const, reason: "é".repeat(MAX_ANSWER_BYTES / 2 + 10) };
    const handlers = rpcHandlers(api({ settings: async () => wide as never }));
    await expect(handlers.settings()).rejects.toThrow("too large");
  });
});
