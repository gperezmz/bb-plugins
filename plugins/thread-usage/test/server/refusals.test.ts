/**
 * Pins what every RPC input, setting, agent tool argument and CLI option the
 * plugin validates accepts and refuses, and the text each refusal shows, as
 * 0.3.0 gave them. A change to how the schemas are built cannot alter a
 * refusal a person reads without failing here.
 */
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, { rpcContract } from "../../server";

async function load() {
  const host = createFakePluginHost({ pluginId: "thread-usage" });
  await plugin(host.bb);
  return host.harness.behavior;
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => {
      const { code, message, issues } = error as { code?: string; message: string; issues?: unknown };
      return code === undefined ? { message } : { code, message, issues };
    },
  );

const rpcRefusal = (issues: unknown) => ({ code: "invalid_input", message: "rpc input validation failed", issues });

type Method = keyof typeof rpcContract;

/** For each method and field, a value it takes and one it refuses with the issues shown. */
const RPC: { method: Method; field: string; accepts: unknown; refuses: unknown; issues: unknown }[] = [
  ...(["report", "chip", "refresh"] as const).flatMap((method) => [
    {
      method,
      field: "threadId",
      accepts: { threadId: "thr_a1-B_2" },
      refuses: { threadId: "abc" },
      issues: [{ message: "Not a thread id", path: ["threadId"] }],
    },
    {
      method,
      field: "unknown key",
      accepts: { threadId: "thr_a" },
      refuses: { threadId: "thr_a", extra: 1 },
      issues: [{ message: 'Unrecognized key: "extra"' }],
    },
  ]),
  {
    method: "claimToast",
    field: "rootThreadId",
    accepts: { rootThreadId: "thr_a", amount: 1 },
    refuses: { rootThreadId: "thread", amount: 1 },
    issues: [{ message: "Not a thread id", path: ["rootThreadId"] }],
  },
  {
    method: "claimToast",
    field: "amount",
    accepts: { rootThreadId: "thr_a", amount: 0.01 },
    refuses: { rootThreadId: "thr_a", amount: 0 },
    issues: [{ message: "Too small: expected number to be >0", path: ["amount"] }],
  },
  {
    method: "claimToast",
    field: "amount type",
    accepts: { rootThreadId: "thr_a", amount: 5 },
    refuses: { rootThreadId: "thr_a", amount: "5" },
    issues: [{ message: "Invalid input: expected number, received string", path: ["amount"] }],
  },
  {
    method: "claimToast",
    field: "unknown key",
    accepts: { rootThreadId: "thr_a", amount: 5 },
    refuses: { rootThreadId: "thr_a", amount: 5, extra: true },
    issues: [{ message: 'Unrecognized key: "extra"' }],
  },
  {
    method: "top",
    field: "projectId",
    accepts: { projectId: "proj_a", sinceDays: 7 },
    refuses: { projectId: 1, sinceDays: 7 },
    issues: [{ message: "Invalid input: expected string, received number", path: ["projectId"] }],
  },
  {
    method: "top",
    field: "sinceDays minimum",
    accepts: { projectId: null, sinceDays: 1 },
    refuses: { projectId: null, sinceDays: 0 },
    issues: [{ message: "Too small: expected number to be >=1", path: ["sinceDays"] }],
  },
  {
    method: "top",
    field: "sinceDays maximum",
    accepts: { projectId: null, sinceDays: 3650 },
    refuses: { projectId: null, sinceDays: 3651 },
    issues: [{ message: "Too big: expected number to be <=3650", path: ["sinceDays"] }],
  },
  {
    method: "top",
    field: "sinceDays integer",
    accepts: { projectId: null, sinceDays: 30 },
    refuses: { projectId: null, sinceDays: 1.5 },
    issues: [{ message: "Invalid input: expected int, received number", path: ["sinceDays"] }],
  },
  {
    method: "top",
    field: "unknown key",
    accepts: { projectId: null, sinceDays: 30 },
    refuses: { projectId: null, sinceDays: 30, limit: 5 },
    issues: [{ message: 'Unrecognized key: "limit"' }],
  },
  ...(["status", "testConnection", "exportAll"] as const).map((method) => ({
    method,
    field: "input",
    accepts: null,
    refuses: {},
    issues: [{ message: "Invalid input: expected null, received object" }],
  })),
  {
    method: "backfill",
    field: "action",
    accepts: { action: "retry-failed" },
    refuses: { action: "stop" },
    issues: [{ message: 'Invalid option: expected one of "pause"|"resume"|"retry-failed"', path: ["action"] }],
  },
  {
    method: "backfill",
    field: "unknown key",
    accepts: { action: "pause" },
    refuses: { action: "pause", now: true },
    issues: [{ message: 'Unrecognized key: "now"' }],
  },
];

const OVERRIDE_PRICE = { input: 1, output: 4 };

/** For each setting with a schema, a value it takes and one it refuses with the text shown. */
const SETTINGS: { setting: string; accepts: string | number; refuses: string | number; text: string }[] = [
  { setting: "gatewayUrl", accepts: "https://llm.example.com", refuses: "ftp://llm.example.com", text: "Must be an http(s) URL" },
  { setting: "gatewayUrl", accepts: "", refuses: "https://llm example.com", text: "Must be an http(s) URL" },
  {
    setting: "extraHeaders",
    accepts: "X-Team: usage",
    refuses: "Authorization: Bearer x",
    text: 'Line 1: "Authorization" carries credentials; bb shows these values in the timeline, so it is not allowed here',
  },
  { setting: "extraHeaders", accepts: "", refuses: "no colon", text: 'Line 1: expected "Name: Value"' },
  {
    setting: "priceOverrides",
    accepts: JSON.stringify({ aliases: { a: "b" }, prices: { m: { ...OVERRIDE_PRICE, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } } }),
    refuses: "{",
    text: "Not valid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)",
  },
  { setting: "priceOverrides", accepts: "", refuses: "[]", text: "value: Invalid input: expected object, received array" },
  { setting: "priceOverrides", accepts: "{}", refuses: JSON.stringify({ models: {} }), text: 'value: Unrecognized key: "models"' },
  { setting: "priceOverrides", accepts: JSON.stringify({ aliases: {} }), refuses: JSON.stringify({ aliases: { a: "" } }), text: "aliases.a: Too small: expected string to have >=1 characters" },
  { setting: "priceOverrides", accepts: JSON.stringify({ aliases: { a: "b" } }), refuses: JSON.stringify({ aliases: { "": "b" } }), text: "aliases.: Invalid key in record" },
  { setting: "priceOverrides", accepts: JSON.stringify({ aliases: { a: "b" } }), refuses: JSON.stringify({ aliases: { a: 1 } }), text: "aliases.a: Invalid input: expected string, received number" },
  { setting: "priceOverrides", accepts: JSON.stringify({ prices: {} }), refuses: JSON.stringify({ prices: { "": OVERRIDE_PRICE } }), text: "prices.: Invalid key in record" },
  { setting: "priceOverrides", accepts: JSON.stringify({ prices: { m: OVERRIDE_PRICE } }), refuses: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, input: -1 } } }), text: "prices.m.input: Too small: expected number to be >=0" },
  { setting: "priceOverrides", accepts: JSON.stringify({ prices: { m: { input: 0, output: 0 } } }), refuses: JSON.stringify({ prices: { m: { input: 1 } } }), text: "prices.m.output: Invalid input: expected number, received undefined" },
  { setting: "priceOverrides", accepts: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, cacheRead: 2 } } }), refuses: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, cacheRead: -1 } } }), text: "prices.m.cacheRead: Too small: expected number to be >=0" },
  { setting: "priceOverrides", accepts: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, cacheWrite: 2 } } }), refuses: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, cacheWrite: "2" } } }), text: "prices.m.cacheWrite: Invalid input: expected number, received string" },
  { setting: "priceOverrides", accepts: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, cacheWrite1h: 2 } } }), refuses: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, cacheWrite1h: -2 } } }), text: "prices.m.cacheWrite1h: Too small: expected number to be >=0" },
  { setting: "priceOverrides", accepts: JSON.stringify({ prices: { m: OVERRIDE_PRICE } }), refuses: JSON.stringify({ prices: { m: { ...OVERRIDE_PRICE, currency: "EUR" } } }), text: 'prices.m: Unrecognized key: "currency"' },
  { setting: "warnAbove", accepts: 0, refuses: -1, text: "Too small: expected number to be >=0" },
  { setting: "warnAbove", accepts: 12.5, refuses: -0.01, text: "Too small: expected number to be >=0" },
  { setting: "currency", accepts: "credits", refuses: " ", text: "1 to 12 characters" },
  { setting: "currency", accepts: "123456789012", refuses: "1234567890123", text: "1 to 12 characters" },
];

/** CLI options the SDK checks from the plugin's declarations, with the first line of the refusal. */
const CLI: { argv: string[]; accepted: string[]; stderr: string }[] = [
  { argv: ["top", "--limit", "0"], accepted: ["top", "--limit", "1"], stderr: "invalid value '0' for --limit. Expected an integer between 1 and 200" },
  { argv: ["top", "--limit", "201"], accepted: ["top", "--limit", "200"], stderr: "invalid value '201' for --limit. Expected an integer between 1 and 200" },
  { argv: ["top", "--limit", "2.5"], accepted: ["top", "--limit", "20"], stderr: "invalid value '2.5' for --limit. Expected an integer between 1 and 200" },
  { argv: ["top", "--since", "soon"], accepted: ["top", "--since", "30d"], stderr: "invalid value 'soon' for --since. Expected a duration with a unit (1500ms, 90s, 5m, 2h) or a bare number of days" },
  { argv: ["top", "--colour"], accepted: ["top", "--json"], stderr: "unknown option '--colour'" },
  { argv: ["show", "thr_a", "--wide"], accepted: ["show", "thr_a", "--no-children"], stderr: "unknown option '--wide'" },
];

describe("RPC input", () => {
  it.each(RPC)("$method accepts and refuses $field", async ({ method, accepts, refuses, issues }) => {
    const accepted = await rpcContract[method].input["~standard"].validate(accepts);
    expect(accepted).not.toHaveProperty("issues");
    const behavior = await load();
    expect(await refusal(behavior.callRpc(method, refuses))).toEqual(rpcRefusal(issues));
  });
});

describe("settings", () => {
  it.each(SETTINGS)("$setting accepts $accepts and refuses $refuses", async ({ setting, accepts, refuses, text }) => {
    const behavior = await load();
    expect(await refusal(behavior.setSettings({ [setting]: accepts }))).toBeUndefined();
    expect(await refusal(behavior.setSettings({ [setting]: refuses }))).toEqual({ message: text });
  });
});

describe("agent tool arguments", () => {
  it("thread_usage takes no arguments and refuses any", async () => {
    const behavior = await load();
    expect(await refusal(behavior.callAgentTool("thread_usage", { a: 1 }))).toEqual({
      message: 'tool "thread_usage" arguments are invalid: (input): Unrecognized key: "a"',
    });
    // Taken, the call reaches the tool, which may fail on the fake host's missing thread.
    expect((await refusal(behavior.callAgentTool("thread_usage", {})))?.message ?? "").not.toContain("arguments are invalid");
  });
});

describe("CLI options", () => {
  it.each(CLI)("bb thread-usage $argv", async ({ argv, accepted, stderr }) => {
    const behavior = await load();
    const refused = await behavior.runCli(argv);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr?.split("\n")[0]).toBe(stderr);
    expect((await behavior.runCli(accepted, { threadId: "thr_a" })).stderr?.split("\n")[0] ?? "").not.toMatch(/^invalid value|^unknown option/);
  });

  it("show without a thread id names what is missing", async () => {
    const behavior = await load();
    const result = await behavior.runCli(["show"]);
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
      exitCode: 1,
      stderr: "no thread id given (Pass a thread id: bb thread-usage show thr_…)\n",
    });
  });
});
