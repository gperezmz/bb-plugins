// The command line through the SDK's fake host, over the real composition and
// a SQLite store: what each command does to the fleet it names, and what it
// prints for a person.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compose } from "../../compose";
import type { LedgerEntry, LedgerRow } from "../application/ports";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "@get-bb/plugin-sdk";
import { LEDGER_LIMIT } from "../application/dashboard";
import { createFleetCli, statusLines } from "./cli";
import type { FleetStatus } from "../application/status";
import { SqliteStore } from "./store";

const REPO = "github.example/org/repo";
const MANAGER = "thr_manager";
const OTHER = "github.example/org/other";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unattendish-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function load() {
  const host: FakePluginHost = createFakePluginHost({
    pluginId: "unattendish-sdlc",
    settings: { credentials: "[]" },
    sdk: { threads: { get: async () => ({ id: MANAGER, archivedAt: null, deletedAt: null }) } },
  });
  const fleets = await compose(host.bb);
  host.bb.cli.register(createFleetCli(fleets.app));
  const store = new SqliteStore(host.bb.storage.database());
  const run = (argv: string[], threadId?: string) => host.harness.runCli(argv, threadId === undefined ? undefined : { threadId });
  const json = async (argv: string[], threadId?: string) => JSON.parse((await run([...argv, "--json"], threadId)).stdout);
  /** Runs a command that must fail, with `--json` so the failure is printed as an object; returns its `error`. */
  const fails = async (argv: string[], threadId?: string): Promise<{ code: string; message: string }> => {
    const failed = await run([...argv, "--json"], threadId);
    expect(failed.exitCode).not.toBe(0);
    return JSON.parse(failed.stdout).error;
  };
  return { host, store, run, json, fails };
}

const registerArgs = (repo = REPO) => [
  "fleet", "register", "--contract", "1", "--repo", repo, "--tracker", "forge-issues", "--manifest", join(dir, "manifest.md"), "--operator", "olivia",
  "--label-spec", "spec", "--label-ready", "ready", "--label-in-progress", "in-progress", "--label-needs-input", "needs-input", "--marker", "🤖 unattendish agent",
];

const row = (key: string, ref: string, disposition: LedgerRow["disposition"], over: Partial<Omit<LedgerRow, "wakeId">> = {}): Omit<LedgerRow, "wakeId"> => ({
  key,
  role: "forge",
  ref,
  url: `https://github.example/org/repo/issues/${ref.slice(1)}`,
  kind: "commented",
  label: null,
  actor: "alice",
  at: "2026-10-12T09:00:00.000Z",
  seenAt: "2026-10-12T09:01:00.000Z",
  disposition,
  rule: disposition === "echo" ? "marker" : null,
  ...over,
});

/** A ledger with one change of each disposition, one failed read, and a poll. */
function seed(store: SqliteStore, repo = REPO) {
  store.recordChange(repo, row("k1", "#1", "wake"));
  store.recordChange(repo, row("k2", "#2", "echo"));
  store.recordChange(repo, row("k3", "#3", "out-of-scope"));
  store.recordChange(repo, row("k4", "#4", "held", { rule: "no manager" }));
  store.recordChange(repo, row("k1b", "#1", "echo", { seenAt: "2026-10-12T09:02:00.000Z" }));
  store.recordFailedRead(repo, { at: "2026-10-12T09:03:00.000Z", role: "forge", ref: "#5", reason: "no state" });
  store.recordPoll(repo, { at: "2026-10-12T09:04:00.000Z", role: "forge", requests: [{ method: "GET", path: "/repos/org/repo/issues", status: 200, counted: true }], counted: 1, ok: true });
}

const changes = (entries: LedgerEntry[]) => entries.flatMap((e) => (e.type === "change" ? [`${e.row.ref} ${e.row.disposition}`] : []));

describe("fleet unregister", () => {
  it("removes the fleet, so status shows none, and says so a second time", async () => {
    const { run, json } = await load();
    await run(registerArgs(), MANAGER);
    expect((await json(["fleet", "status"])).fleets).toHaveLength(1);

    expect(await json(["fleet", "unregister", REPO])).toEqual({ outcome: "unregistered" });
    expect((await json(["fleet", "status"])).fleets).toEqual([]);
    expect(await json(["fleet", "unregister", REPO])).toEqual({ outcome: "not-registered" });
  });

  it("removes only the fleet it names", async () => {
    const { run, json } = await load();
    await run(registerArgs(), MANAGER);
    await run(registerArgs(OTHER), "thr_other");
    await run(["fleet", "unregister", REPO]);
    expect((await json(["fleet", "status"])).fleets.map((f: { repo: string }) => f.repo)).toEqual([OTHER]);
  });

  it("refuses text that is not a repository", async () => {
    const { fails } = await load();
    expect((await fails(["fleet", "unregister", "nonsense"])).code).toBe("invalid_value");
  });
});

describe("fleet ledger", () => {
  it("prints every entry with no filter", async () => {
    const { store, run, json } = await load();
    await run(registerArgs(), MANAGER);
    seed(store);
    const { entries } = await json(["fleet", "ledger", REPO]);
    expect(new Set(entries.map((e: LedgerEntry) => e.type))).toEqual(new Set(["change", "failed read", "poll"]));
    expect(changes(entries)).toHaveLength(5);
  });

  it("--item keeps the item's entries, by reference or by URL, and nothing else", async () => {
    const { store, run, json } = await load();
    await run(registerArgs(), MANAGER);
    seed(store);
    expect(changes((await json(["fleet", "ledger", REPO, "--item", "#1"])).entries).sort()).toEqual(["#1 echo", "#1 wake"]);
    const byUrl = (await json(["fleet", "ledger", REPO, "--item", "https://github.example/org/repo/issues/3"])).entries;
    expect(changes(byUrl)).toEqual(["#3 out-of-scope"]);
    expect(byUrl).toHaveLength(1);
    expect((await json(["fleet", "ledger", REPO, "--item", "#99"])).entries).toEqual([]);
  });

  it.each([
    ["woke", ["#1 wake"]],
    ["echo", ["#1 echo", "#2 echo"]],
    ["out-of-scope", ["#3 out-of-scope"]],
    ["held", ["#4 held"]],
  ])("--done %s keeps the changes with that disposition", async (done, expected) => {
    const { store, run, json } = await load();
    await run(registerArgs(), MANAGER);
    seed(store);
    const { entries } = await json(["fleet", "ledger", REPO, "--done", done]);
    expect(changes(entries).sort()).toEqual(expected);
    expect(entries).toHaveLength(expected.length);
  });

  it("--done failed-read keeps the failed reads and no change", async () => {
    const { store, run, json } = await load();
    await run(registerArgs(), MANAGER);
    seed(store);
    const { entries } = await json(["fleet", "ledger", REPO, "--done", "failed-read"]);
    expect(entries).toEqual([{ type: "failed read", at: "2026-10-12T09:03:00.000Z", role: "forge", ref: "#5", reason: "no state" }]);
    expect((await json(["fleet", "ledger", REPO, "--done", "failed-read", "--item", "#6"])).entries).toEqual([]);
  });

  describe("--done skipped-listing", () => {
    const WINDOW = { from: "2026-10-12T09:50:00.000Z", to: "2026-10-12T10:00:00.000Z" };
    /** The entry a poll writes when a listing is cut at its page limit: no item, and the window it listed. */
    const skipped = (key: string, seenAt: string): Omit<LedgerRow, "wakeId"> =>
      row(key, "#0", "out-of-scope", { ref: null, url: null, kind: "skipped listing", actor: null, rule: "listing cut at its page limit", window: WINDOW, seenAt });
    /** The `n`th plain out-of-scope change, seen a second after the one before it, from 10:00 on. */
    const plain = (n: number) => row(`plain${n}`, `#${n + 10}`, "out-of-scope", { seenAt: new Date(Date.UTC(2026, 9, 12, 10, 0, n)).toISOString() });

    it("prints only the Skipped listings, newest first, past any number of plain out-of-scope changes", async () => {
      const { store, run, json } = await load();
      await run(registerArgs(), MANAGER);
      store.recordChange(REPO, skipped("older", "2026-10-12T09:20:00.000Z"));
      store.recordChange(REPO, skipped("newer", "2026-10-12T09:30:00.000Z"));
      for (let n = 0; n < 300; n += 1) store.recordChange(REPO, plain(n));
      const { entries } = await json(["fleet", "ledger", REPO, "--done", "skipped-listing"]);
      expect(entries.map((e: LedgerEntry) => (e.type === "change" ? e.row.key : e.type))).toEqual(["newer", "older"]);
      expect(entries.every((e: LedgerEntry) => e.type === "change" && e.row.kind === "skipped listing")).toBe(true);
    });

    it("keeps the newest Skipped listings up to --limit", async () => {
      const { store, run, json } = await load();
      await run(registerArgs(), MANAGER);
      store.recordChange(REPO, skipped("first", "2026-10-12T09:10:00.000Z"));
      store.recordChange(REPO, skipped("second", "2026-10-12T09:20:00.000Z"));
      store.recordChange(REPO, skipped("third", "2026-10-12T09:30:00.000Z"));
      const { entries } = await json(["fleet", "ledger", REPO, "--done", "skipped-listing", "--limit", "2"]);
      expect(entries.map((e: LedgerEntry) => (e.type === "change" ? e.row.key : e.type))).toEqual(["third", "second"]);
    });

    it("prints a Skipped listing as the text form names it", async () => {
      const { store, run } = await load();
      await run(registerArgs(), MANAGER);
      store.recordChange(REPO, skipped("cut", "2026-10-12T09:30:00.000Z"));
      const printed = await run(["fleet", "ledger", REPO, "--done", "skipped-listing"]);
      expect(printed.exitCode).toBe(0);
      expect(printed.stdout).toBe("2026-10-12T09:30:00.000Z  out of scope: listing cut at its page limit  listed 2026-10-12T09:50:00.000Z to 2026-10-12T10:00:00.000Z, reached 2026-10-12T09:00:00.000Z");
    });

    it("prints that the ledger holds nothing when no Skipped listing is held", async () => {
      const { store, run, json } = await load();
      await run(registerArgs(), MANAGER);
      seed(store);
      const printed = await run(["fleet", "ledger", REPO, "--done", "skipped-listing"]);
      expect(printed.exitCode).toBe(0);
      expect(printed.stdout).toBe("The ledger holds nothing for this.");
      expect((await json(["fleet", "ledger", REPO, "--done", "skipped-listing"])).entries).toEqual([]);
    });

    it("prints nothing with --item, since a Skipped listing names no item", async () => {
      const { store, run } = await load();
      await run(registerArgs(), MANAGER);
      store.recordChange(REPO, skipped("cut", "2026-10-12T09:30:00.000Z"));
      const printed = await run(["fleet", "ledger", REPO, "--done", "skipped-listing", "--item", "#0"]);
      expect(printed.exitCode).toBe(0);
      expect(printed.stdout).toBe("The ledger holds nothing for this.");
    });

    it("leaves --done out-of-scope including Skipped listings beside the plain ones", async () => {
      const { store, run, json } = await load();
      await run(registerArgs(), MANAGER);
      seed(store);
      store.recordChange(REPO, skipped("cut", "2026-10-12T09:30:00.000Z"));
      const { entries } = await json(["fleet", "ledger", REPO, "--done", "out-of-scope"]);
      expect(entries.map((e: LedgerEntry) => (e.type === "change" ? e.row.kind : e.type)).sort()).toEqual(["commented", "skipped listing"]);
    });
  });

  it("--limit keeps the newest entries", async () => {
    const { store, run, json } = await load();
    await run(registerArgs(), MANAGER);
    seed(store);
    const { entries } = await json(["fleet", "ledger", REPO, "--limit", "2"]);
    expect(entries.map((e: LedgerEntry) => e.type)).toEqual(["poll", "failed read"]);
  });

  describe("--limit and bb's output limit", () => {
    const huge = "x".repeat(1_000);
    /** The widest entries there can be, of every kind, more of them than any limit allows. */
    function widest(store: SqliteStore, n = LEDGER_LIMIT + 50) {
      for (let i = 0; i < n; i += 1) {
        store.recordChange(REPO, row(`k${i}-${huge}`, `#${i}`, "echo", { url: `https://github.example/${huge}`, label: huge, actor: huge, rule: huge, seenAt: `2026-10-12T09:${String(i % 60).padStart(2, "0")}:00.${String(i).padStart(3, "0")}Z` }));
        store.recordFailedRead(REPO, { at: `2026-10-12T10:00:00.${String(i).padStart(3, "0")}Z`, role: "forge", ref: huge, reason: huge });
        store.recordPoll(REPO, {
          at: `2026-10-12T11:00:00.${String(i).padStart(3, "0")}Z`,
          role: "forge",
          requests: Array.from({ length: 40 }, () => ({ method: "GET", path: `/${huge}`, status: 200, counted: true })),
          counted: 40,
          ok: true,
        });
      }
    }

    it.each([["the text", []], ["the JSON", ["--json"]]])("prints the most it accepts, of the widest entries, in %s, within bb's output limit", async (_, flags) => {
      const { store, run } = await load();
      await run(registerArgs(), MANAGER);
      widest(store);
      const printed = await run(["fleet", "ledger", REPO, "--limit", String(LEDGER_LIMIT), ...flags]);
      expect(printed.exitCode).toBe(0);
      expect(printed.stderr).toBe("");
      expect(Buffer.byteLength(printed.stdout)).toBeLessThan(PLUGIN_CLI_OUTPUT_MAX_BYTES);
      if (flags.length > 0) expect(JSON.parse(printed.stdout).entries).toHaveLength(LEDGER_LIMIT);
    });

    it("cuts a long string and a poll's request list to what fits, and says how many requests it left out", async () => {
      const { store, json } = await load();
      await run_register(store);
      widest(store, 1);
      const { entries } = await json(["fleet", "ledger", REPO]);
      const poll = entries.find((e: LedgerEntry) => e.type === "poll");
      expect(poll.poll.requests).toHaveLength(5);
      expect(poll.requestsOmitted).toBe(35);
      expect(poll.poll.counted).toBe(40);
      expect(poll.poll.requests[0].path.length).toBeLessThanOrEqual(200);
      const change = entries.find((e: LedgerEntry) => e.type === "change");
      expect(change.row.url.length).toBeLessThanOrEqual(200);
    });

    it("refuses a limit above the cap, naming it", async () => {
      const { fails } = await load();
      const error = await fails(["fleet", "ledger", REPO, "--limit", String(LEDGER_LIMIT + 1)]);
      expect(error.message).toContain(String(LEDGER_LIMIT));
      expect(LEDGER_LIMIT).toBe(250);
    });

    async function run_register(store: SqliteStore) {
      void store;
    }
  });

  it("refuses a --done value outside the five", async () => {
    const { run } = await load();
    expect((await run(["fleet", "ledger", REPO, "--done", "sent"])).exitCode).not.toBe(0);
  });
});

describe("fleet interval", () => {
  const intervalOf = async (json: (argv: string[]) => Promise<{ fleets: { intervalMs: number }[] }>) => (await json(["fleet", "status"])).fleets[0]!.intervalMs;

  it("`default` puts a set interval back to 2 minutes", async () => {
    const { run, json } = await load();
    await run(registerArgs(), MANAGER);
    await run(["fleet", "interval", REPO, "45s"]);
    expect(await intervalOf(json)).toBe(45_000);
    expect(await json(["fleet", "interval", REPO, "default"])).toEqual({ outcome: "interval-set", intervalMs: null });
    expect(await intervalOf(json)).toBe(120_000);
  });

  it("reads seconds, minutes and hours", async () => {
    const { run, json } = await load();
    await run(registerArgs(), MANAGER);
    for (const [text, ms] of [["30s", 30_000], ["5m", 300_000], ["1h", 3_600_000]] as const) {
      await run(["fleet", "interval", REPO, text]);
      expect(await intervalOf(json)).toBe(ms);
    }
  });

  it.each(["soon", "10", "-5s", "1.5m", "5 minutes", ""])("refuses %j as a duration with invalid_value, leaving the interval alone", async (text) => {
    const { run, json, fails } = await load();
    await run(registerArgs(), MANAGER);
    expect((await fails(["fleet", "interval", REPO, text])).code).toBe("invalid_value");
    expect(await intervalOf(json)).toBe(120_000);
  });

  it("refuses an interval under the floor with interval_too_short", async () => {
    const { run, fails } = await load();
    await run(registerArgs(), MANAGER);
    expect((await fails(["fleet", "interval", REPO, "29s"])).code).toBe("interval_too_short");
  });

  it("refuses a repository no fleet holds with not_registered", async () => {
    const { fails } = await load();
    expect((await fails(["fleet", "interval", REPO, "1m"])).code).toBe("not_registered");
  });
});

describe("fleet register", () => {
  const without = (option: string) => {
    const argv = registerArgs();
    const at = argv.indexOf(option);
    return [...argv.slice(0, at), ...argv.slice(at + 2)];
  };

  it.each(["--contract", "--repo", "--tracker", "--manifest", "--operator", "--label-spec", "--label-ready", "--label-in-progress", "--label-needs-input", "--marker"])("fails with a code when %s is missing, and registers nothing", async (option) => {
    const { json, fails } = await load();
    const failure = await fails(without(option), MANAGER);
    expect(failure.code).toBe("missing_required");
    expect(failure.message).toBe(`missing required options: ${option}`);
    expect((await json(["fleet", "status"])).fleets).toEqual([]);
  });

  it("fails with no_thread outside a manager's thread", async () => {
    const { fails } = await load();
    expect((await fails(registerArgs())).code).toBe("no_thread");
  });
});

describe("the human output of every command", () => {
  it("register says it registered, then refuses another thread naming the holder", async () => {
    const { run } = await load();
    const first = await run(registerArgs(), MANAGER);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toMatch(/^Registered \(/);
    const refused = await run(registerArgs(), "thr_second");
    expect(refused.exitCode).toBe(0);
    expect(refused.stdout).toBe(`Refused: thread ${MANAGER} holds this repository`);
  });

  it("register says a contract version it does not speak is unsupported", async () => {
    const { run } = await load();
    const argv = registerArgs();
    argv[argv.indexOf("--contract") + 1] = "2";
    expect((await run(argv, MANAGER)).stdout).toMatch(/^Unsupported contract version; this plugin speaks 1/);
  });

  it("unregister says what it did", async () => {
    const { run } = await load();
    await run(registerArgs(), MANAGER);
    expect((await run(["fleet", "unregister", REPO])).stdout).toBe("Unregistered.");
    expect((await run(["fleet", "unregister", REPO])).stdout).toBe("No fleet is registered for that repository.");
  });

  it("status names each fleet's repository, manager, manifest, interval and why it is not watched", async () => {
    const { run } = await load();
    expect((await run(["fleet", "status"])).stdout).toBe("No fleet is registered.");
    await run(registerArgs(), MANAGER);
    const text = (await run(["fleet", "status"])).stdout;
    expect(text).toContain(REPO);
    expect(text).toContain("tracker forge-issues");
    expect(text).toContain(`manager ${MANAGER} (live)`);
    expect(text).toContain(join(dir, "manifest.md"));
    expect(text).toContain("every 120 s");
    expect(text).toContain("last polled never");
    expect(text).toContain("not watched:");
  });

  it("status says a fleet whose manifest names another repository is left behind, and prints none of its rows (#270 AC6)", async () => {
    const { run, json } = await load();
    writeFileSync(join(dir, "manifest.md"), `# Fleet: ${OTHER}\n\n## Inbox\n\n| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n| nope | x | answer | 2026-10-12T09:00:00Z | x |\n`);
    await run(registerArgs(), MANAGER);
    const text = (await run(["fleet", "status"])).stdout;
    expect(text).toContain(`left behind: its manifest names ${OTHER}, so only its labelled items are watched`);
    expect(text).not.toContain("unreadable manifest row");
    expect(text).not.toMatch(/^  watched$/m);
    const [fleet] = (await json(["fleet", "status"])).fleets;
    expect(fleet).toMatchObject({ leftBehind: { names: OTHER }, unreadableRows: [], outside: [] });
  });

  it("status prints a watched left-behind fleet's left-behind line in place of `watched` (#270 AC6)", () => {
    const base: FleetStatus = {
      repo: REPO, tracker: "forge-issues", manager: MANAGER, managerState: "live", manifest: "/m.md", lastPolledAt: null, intervalMs: 120_000, accounts: [], credentials: [],
      requestsThisHour: 0, watched: true, leftBehind: null, notWatched: [], notWatchedSince: null, unreadableRows: [], outside: [], heldSince: null,
    };
    expect(statusLines([base])).toMatch(/^  watched$/m);
    const left = statusLines([{ ...base, leftBehind: { names: OTHER } }]);
    expect(left).toContain(`  left behind: its manifest names ${OTHER}, so only its labelled items are watched`);
    expect(left).not.toMatch(/^  watched$/m);
  });

  it("ledger prints one line per entry with its item, what became of it and its link, and says when it holds nothing", async () => {
    const { store, run } = await load();
    await run(registerArgs(), MANAGER);
    expect((await run(["fleet", "ledger", REPO])).stdout).toBe("The ledger holds nothing for this.");
    seed(store);
    const text = (await run(["fleet", "ledger", REPO])).stdout;
    expect(text).toContain("#1 commented by alice: woke the manager  https://github.example/org/repo/issues/1");
    expect(text).toContain("#2 commented by alice: echo (marker)");
    expect(text).toContain("#3 commented by alice: out-of-scope");
    expect(text).toContain("#4 commented by alice: held (no manager)");
    expect(text).toContain("failed read of the forge #5: no state");
    expect(text).toContain("poll of the forge: 1 requests, 1 counted against the rate limit");
  });

  it("ledger prints the entry a cut-off listing wrote by its time, reason, window and the time it reached, and its JSON keeps no ref or link (#263)", async () => {
    const { store, run, json } = await load();
    await run(registerArgs(), MANAGER);
    store.recordChange(REPO, row("cut", "", "out-of-scope", { ref: null, url: null, kind: "skipped listing", actor: null, at: "2026-10-12T08:58:00.000Z", seenAt: "2026-10-12T09:01:00.000Z", rule: "listing cut at its page limit", window: { from: "2026-10-12T08:55:00.000Z", to: "2026-10-12T09:00:00.000Z" } }));
    expect((await run(["fleet", "ledger", REPO])).stdout).toBe("2026-10-12T09:01:00.000Z  out of scope: listing cut at its page limit  listed 2026-10-12T08:55:00.000Z to 2026-10-12T09:00:00.000Z, reached 2026-10-12T08:58:00.000Z");
    const { entries } = await json(["fleet", "ledger", REPO, "--done", "out-of-scope"]);
    expect(entries).toHaveLength(1);
    expect(entries[0].row).toMatchObject({ ref: null, url: null, kind: "skipped listing", at: "2026-10-12T08:58:00.000Z", window: { from: "2026-10-12T08:55:00.000Z", to: "2026-10-12T09:00:00.000Z" } });
  });

  it("interval says what it set", async () => {
    const { run } = await load();
    await run(registerArgs(), MANAGER);
    expect((await run(["fleet", "interval", REPO, "45s"])).stdout).toBe("Polling every 45s.");
    expect((await run(["fleet", "interval", REPO, "default"])).stdout).toBe("Back to the default interval.");
  });
});
