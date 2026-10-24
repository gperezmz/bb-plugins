// #330: reading pull requests from bb's GitHub PR Status plugin, AC3 and AC4.
import { describe, expect, it } from "vitest";
import { CAPTURED_PULL_REQUESTS } from "../testing/github-pr-status";
import { createSdkPullRequests } from "./pull-requests";

interface FakeOptions {
  /** The answer to each call, from the keys asked; a throw fails the call as bb refuses it. */
  answer?: (keys: string[]) => unknown;
  /** What `plugins.list` lists; a throw fails it. */
  plugins?: () => { id: string; enabled: boolean }[];
}

function fakeBb(options: FakeOptions = {}) {
  const calls: { pluginId: string; method: string; keys: string[] }[] = [];
  const errors: string[] = [];
  const answer = options.answer ?? ((keys: string[]) => Object.fromEntries(keys.map((key) => [key, CAPTURED_PULL_REQUESTS[key as keyof typeof CAPTURED_PULL_REQUESTS] ?? { outcome: "absent" }])));
  const bb = {
    sdk: {
      plugins: {
        async callRpc(args: { pluginId: string; method: string; input: { keys: string[] }; outputSchema: { parse(value: unknown): unknown } }) {
          calls.push({ pluginId: args.pluginId, method: args.method, keys: args.input.keys });
          return args.outputSchema.parse(answer(args.input.keys));
        },
        async list() {
          return { plugins: (options.plugins ?? (() => [{ id: "bb--github-pr-status", enabled: true }]))() };
        },
      },
    },
    log: { debug() {}, info() {}, warn() {}, error: (message: string) => void errors.push(message) },
  };
  return { pullRequests: createSdkPullRequests(bb as never), calls, errors };
}

describe("reading GitHub PR Status", () => {
  it("AC4: reads an answer captured from bb 0.47.1's bundled plugin", async () => {
    const { pullRequests, calls, errors } = fakeBb({ answer: () => CAPTURED_PULL_REQUESTS });
    const found = await pullRequests.read(["env_merged", "env_none", "env_offline", "env_gone"]);
    expect(calls).toEqual([{ pluginId: "bb--github-pr-status", method: "pullRequests", keys: ["env_merged", "env_none", "env_offline", "env_gone"] }]);
    expect(Object.fromEntries(found)).toEqual({
      env_merged: { kind: "available", state: "merged", updatedAt: Date.parse("2026-10-22T19:27:07Z") },
      env_none: { kind: "absent" },
      env_offline: { kind: "unknown" },
      env_gone: { kind: "no-lookup" },
    });
    expect(errors).toEqual([]);
  });

  it("AC3: keeps every unavailable answer as unknown, whatever its message, a remote not on GitHub included", async () => {
    const message = "gh pr view failed: none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`";
    const { pullRequests } = fakeBb({ answer: () => ({ env: { outcome: "unavailable", message } }) });
    expect((await pullRequests.read(["env"])).get("env")).toEqual({ kind: "unknown" });
  });

  it("reads a workspace that is gone as nothing left to ask, by the message GitHub PR Status 0.1.0 gives, and a reworded one as unknown", async () => {
    const { pullRequests } = fakeBb({
      answer: () => ({
        gone: CAPTURED_PULL_REQUESTS.env_gone,
        reworded: { outcome: "unavailable", message: "The workspace at /tmp/tmp.qpn5eBNR89 is gone" },
      }),
    });
    expect(Object.fromEntries(await pullRequests.read(["gone", "reworded"]))).toEqual({ gone: { kind: "no-lookup" }, reworded: { kind: "unknown" } });
  });

  it("reads a pull request whose attention, checks, review or mergeability holds a value it does not know, since auto-settle reads only its state and time", async () => {
    const pullRequest = { ...CAPTURED_PULL_REQUESTS.env_merged.pullRequest, attention: "auto_merging", checks: { state: "skipped" }, review: undefined };
    const { pullRequests, errors } = fakeBb({ answer: () => ({ env: { outcome: "available", pullRequest } }) });
    expect((await pullRequests.read(["env"])).get("env")).toMatchObject({ kind: "available", state: "merged" });
    expect(errors).toEqual([]);
  });

  it("reads a pull request whose time does not parse as one with no time", async () => {
    const { pullRequests } = fakeBb({
      answer: () => ({ env: { ...CAPTURED_PULL_REQUESTS.env_merged, pullRequest: { ...CAPTURED_PULL_REQUESTS.env_merged.pullRequest, updatedAt: "soon" } } }),
    });
    expect((await pullRequests.read(["env"])).get("env")).toEqual({ kind: "available", state: "merged", updatedAt: null });
  });

  it("AC4: logs a row out of shape as an error naming the mismatch, reads it as unknown, and reads the other rows", async () => {
    const { pullRequests, errors } = fakeBb({
      answer: () => ({ bad: { outcome: "available", pullRequest: { ...CAPTURED_PULL_REQUESTS.env_merged.pullRequest, state: "landed" } }, env_merged: CAPTURED_PULL_REQUESTS.env_merged }),
    });
    const found = await pullRequests.read(["bad", "env_merged", "missing"]);
    expect(found.get("bad")).toEqual({ kind: "unknown" });
    expect(found.get("missing")).toEqual({ kind: "unknown" });
    expect(found.get("env_merged")).toMatchObject({ kind: "available", state: "merged" });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^GitHub PR Status answered environment bad in a shape Thread Glance does not expect: pullRequest\.state: /);
    expect(errors[1]).toMatch(/^GitHub PR Status answered environment missing in a shape Thread Glance does not expect: /);
  });

  it("AC4: logs an answer that is not a record of rows and reads every environment as unknown", async () => {
    const { pullRequests, errors } = fakeBb({ answer: () => [] });
    expect(Object.fromEntries(await pullRequests.read(["a", "b"]))).toEqual({ a: { kind: "unknown" }, b: { kind: "unknown" } });
    expect(errors).toEqual(["GitHub PR Status answered pullRequests in a shape Thread Glance does not expect: not a record of rows"]);
  });

  it.each([
    ["absent", () => []],
    ["disabled", () => [{ id: "bb--github-pr-status", enabled: false }]],
  ])("AC3: reads every environment as nothing left to ask when GitHub PR Status is %s", async (_case, plugins) => {
    const { pullRequests } = fakeBb({
      answer: () => {
        throw new Error('HTTP 503: plugin "bb--github-pr-status" is not running (status: disabled)');
      },
      plugins,
    });
    expect(Object.fromEntries(await pullRequests.read(["a", "b"]))).toEqual({ a: { kind: "no-lookup" }, b: { kind: "no-lookup" } });
  });

  it.each([
    ["the plugin is enabled", () => [{ id: "bb--github-pr-status", enabled: true }]],
    [
      "bb cannot list its plugins",
      () => {
        throw new Error("bb is busy");
      },
    ],
  ])("AC3: reads a failed call as unknown when %s", async (_case, plugins) => {
    const { pullRequests } = fakeBb({
      answer: () => {
        throw new Error("HTTP 500: handler failed");
      },
      plugins,
    });
    expect((await pullRequests.read(["a"])).get("a")).toEqual({ kind: "unknown" });
  });

  it("asks at most 200 environments a call", async () => {
    const { pullRequests, calls } = fakeBb();
    const ids = Array.from({ length: 401 }, (_, at) => `env_${at}`);
    const found = await pullRequests.read(ids);
    expect(calls.map((call) => call.keys.length)).toEqual([200, 200, 1]);
    expect(found.size).toBe(401);
  });
});
