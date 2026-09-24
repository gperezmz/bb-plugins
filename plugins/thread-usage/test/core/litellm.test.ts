import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fetchModelInfo,
  formatLiteLlmDate,
  GatewayError,
  parseSpendRow,
  sweepSpendLogs,
  testConnection,
  type LiteLlmConfig,
} from "../../src/core/litellm";
import { startFakeLiteLlm, type FakeLiteLlm } from "../fake-litellm.mjs";
import { MIN, T0 } from "./fixtures";

const KEY = "sk-test-read";
let fake: FakeLiteLlm;
let config: LiteLlmConfig;

beforeEach(async () => {
  fake = await startFakeLiteLlm({ key: KEY });
  config = { baseUrl: `${fake.url}/`, key: KEY, fetch, timeoutMs: 2000 };
});
afterEach(async () => {
  await fake.close();
});

const iso = (ms: number) => new Date(ms).toISOString();

describe("formatLiteLlmDate and parseSpendRow", () => {
  it("formats dates as YYYY-MM-DD HH:MM:SS in UTC", () => {
    expect(formatLiteLlmDate(Date.UTC(2026, 0, 2, 3, 4, 5, 678))).toBe("2026-01-02 03:04:05");
  });

  it("reads zone-less timestamps as UTC and falls back to model_group", () => {
    const row = parseSpendRow({
      request_id: "r1",
      session_id: "bb-thr_abc",
      startTime: "2026-06-01 12:00:00",
      endTime: "2026-06-01T12:00:02.500000",
      model: "",
      model_group: "team-opus",
      prompt_tokens: 10,
      completion_tokens: 2,
      spend: 0.5,
      request_duration_ms: 2500,
      status: "success",
    })!;
    expect(row).toMatchObject({
      threadId: "thr_abc",
      startTime: T0,
      endTime: T0 + 2500,
      model: "team-opus",
      promptTokens: 10,
      completionTokens: 2,
      spend: 0.5,
      durationMs: 2500,
    });
  });
});

describe("sweepSpendLogs", () => {
  it("asks for bb- sessions with both dates, and follows pages of 1000", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({
      request_id: `r${i}`,
      session_id: `bb-thr_t${i % 7}`,
      startTime: iso(T0 + i * 1000),
    }));
    fake.setRows(rows);
    const result = await sweepSpendLogs(config, T0 - MIN, T0 + 3000 * 1000);
    expect(result.rows).toHaveLength(2345);
    expect(new Set(result.rows.map((r) => r.requestId)).size).toBe(2345);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    const q = fake.requests.filter((r) => r.path === "/spend/logs/v2").map((r) => r.query);
    expect(q.map((x) => x.page)).toEqual(["1", "2", "3"]);
    for (const x of q) {
      expect(x.session_id).toBe("bb-thr_");
      expect(x.page_size).toBe("1000");
      expect(x.start_date).toBe(formatLiteLlmDate(T0 - MIN));
      expect(x.end_date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    expect(fake.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("reads oldest first and, when LiteLLM caps the total at 10,000, resumes from the newest row read", async () => {
    const rows = Array.from({ length: 10_500 }, (_, i) => ({
      request_id: `r${i}`,
      session_id: "bb-thr_busy",
      startTime: iso(T0 + i * 1000),
    }));
    fake.setRows(rows);
    const first = await sweepSpendLogs(config, T0 - MIN, T0 + 20_000 * 1000);
    expect(first.truncated).toBe(true);
    expect(first.rows).toHaveLength(10_000);
    expect(first.rows[0]!.requestId).toBe("r0");
    expect(first.resumeFrom).toBe(T0 + 9_999 * 1000);
    expect(fake.requests.at(-1)!.query.sort_order).toBe("asc");
    const second = await sweepSpendLogs(config, first.resumeFrom!, T0 + 20_000 * 1000);
    expect(second.truncated).toBe(false);
    const all = new Set([...first.rows, ...second.rows].map((r) => r.requestId));
    expect(all.size).toBe(10_500);
  });

  it("re-checks the substring match: rows whose session is not bb-thr_… are dropped", async () => {
    fake.setRows([
      { request_id: "good", session_id: "bb-thr_abc", startTime: iso(T0) },
      { request_id: "prefix", session_id: "xbb-thr_abc", startTime: iso(T0) },
      { request_id: "suffix", session_id: "bb-thr_abc/sub", startTime: iso(T0) },
      { request_id: "bare", session_id: "bb-thr_", startTime: iso(T0) },
      { request_id: "none", session_id: null, startTime: iso(T0) },
    ]);
    const result = await sweepSpendLogs(config, T0 - MIN, T0 + MIN);
    expect(result.rows.map((r) => r.requestId)).toEqual(["good"]);
    expect(result.scanned).toBe(4);
  });

  it("reads only the date window, on startTime", async () => {
    fake.setRows([
      { request_id: "before", session_id: "bb-thr_a", startTime: iso(T0 - 10 * MIN) },
      { request_id: "inside", session_id: "bb-thr_a", startTime: iso(T0) },
      { request_id: "after", session_id: "bb-thr_a", startTime: iso(T0 + 10 * MIN) },
    ]);
    const result = await sweepSpendLogs(config, T0 - MIN, T0 + MIN);
    expect(result.rows.map((r) => r.requestId)).toEqual(["inside"]);
  });

  it("throws a GatewayError naming the failing check", async () => {
    const failing = async () => {
      try {
        await sweepSpendLogs(config, T0, T0 + MIN);
      } catch (error) {
        return error as GatewayError;
      }
      throw new Error("expected a failure");
    };
    fake.setMode("bad-key");
    expect(await failing()).toMatchObject({ check: "key-valid", status: 401 });
    fake.setMode("no-spend");
    expect(await failing()).toMatchObject({ check: "spend-readable", status: 403 });
    fake.setMode("no-route");
    expect(await failing()).toMatchObject({ check: "spend-readable", status: 404 });
    fake.setMode("down");
    const down = await failing();
    expect(down).toBeInstanceOf(GatewayError);
    expect(down.check).toBe("reachable");
  });
});

describe("fetchModelInfo", () => {
  it("reads the gateway price map", async () => {
    const prices = await fetchModelInfo(config);
    expect(prices["claude-opus-5"]).toMatchObject({ input: 4e-6, output: 2e-5 });
    expect(prices["anthropic/claude-opus-5-5"]).toBeDefined();
  });
});

describe("testConnection (scenario 21)", () => {
  const now = T0;
  const statuses = async (anyThreadRan = true, cfg = config) =>
    Object.fromEntries((await testConnection(cfg, now, anyThreadRan)).map((c) => [c.id, c.status]));

  beforeEach(() => {
    fake.setRows([{ request_id: "r1", session_id: "bb-thr_abc", startTime: iso(now - 2 * 86_400_000) }]);
  });

  it("passes all four checks against a healthy gateway with tagged rows", async () => {
    expect(await statuses()).toEqual({ reachable: "pass", "key-valid": "pass", "spend-readable": "pass", "sees-rows": "pass" });
  });

  it("1. fails only 'reachable' when the gateway is down", async () => {
    fake.setMode("down");
    expect(await statuses()).toEqual({ reachable: "fail", "key-valid": "skipped", "spend-readable": "skipped", "sees-rows": "skipped" });
  });

  it("2. fails only 'key-valid' with a refused key", async () => {
    fake.setMode("bad-key");
    expect(await statuses()).toEqual({ reachable: "pass", "key-valid": "fail", "spend-readable": "skipped", "sees-rows": "skipped" });
    fake.setMode("ok");
    expect((await statuses(true, { ...config, key: "sk-wrong" }))["key-valid"]).toBe("fail");
  });

  it("3. fails only 'spend-readable' when the key may not read spend logs, or the route is missing", async () => {
    fake.setMode("no-spend");
    expect(await statuses()).toEqual({ reachable: "pass", "key-valid": "pass", "spend-readable": "fail", "sees-rows": "skipped" });
    // LiteLLM answers 401 (not 403) to a valid key whose role may not read spend logs.
    fake.setMode("no-spend-401");
    expect(await statuses()).toEqual({ reachable: "pass", "key-valid": "pass", "spend-readable": "fail", "sees-rows": "skipped" });
    fake.setMode("no-route");
    const checks = await testConnection(config, now, true);
    expect(checks.map((c) => c.status)).toEqual(["pass", "pass", "fail", "skipped"]);
    expect(checks[2]!.detail).toMatch(/404/);
  });

  it("4. fails only 'sees-rows' when no bb- rows are visible, and warns when no thread ran yet", async () => {
    fake.setMode("empty");
    expect(await statuses(true)).toEqual({ reachable: "pass", "key-valid": "pass", "spend-readable": "pass", "sees-rows": "fail" });
    expect((await statuses(false))["sees-rows"]).toBe("warn");
  });

  it("does not count rows older than 7 days or untagged sessions", async () => {
    fake.setRows([
      { request_id: "old", session_id: "bb-thr_abc", startTime: iso(now - 8 * 86_400_000) },
      { request_id: "other", session_id: "xbb-thr_abc", startTime: iso(now - MIN) },
    ]);
    expect((await statuses(true))["sees-rows"]).toBe("fail");
  });
});
