// Cache Keeper's backend entry: wires bb's thread events, settings, storage
// and host entry to the engine under src/server, and registers the RPC, the
// CLI, the agent tool and the settings the Agent tools section switches.
import { cliCommand, defineCli, PluginCliError, type BbPluginApi, type PluginCliContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DriveClock, onClock, wallClock, type Clock } from "./src/core/clock";
import { formatSize, parseSize } from "./src/core/line";
import { PriceBook } from "./src/core/pricing";
import { CHANGED, type ThreadView } from "./src/core/view";
import { hostContract } from "./src/host/contract";
import { aboveSetting, AboveRefused } from "./src/core/above";
import { AGENT_TOOLS, AgentTools } from "./src/server/agent-tools";
import { ClaudeOnlyError, DAY_MS, Engine, EVENT_TYPES, EVENTS_PAGE, NoTreeTopError, NotReadyError, queuedRowOf, type QueuedRow } from "./src/server/engine";
import { LITELLM_META, MODELS_DEV_META, refreshError, refreshPublicPrices, type FetchedPrices } from "./src/server/public-prices";
import { resetAfterReinstall, RESET_META, type ResetNotice } from "./src/server/reinstall";
import { rpcContract } from "./src/server/rpc";
import { compactWhenIdle, rpcHandlers } from "./src/server/surfaces";
import { parseSettings, SETTINGS, type KeeperSettings } from "./src/server/settings";
import { PINNED_SNAPSHOT } from "./src/server/snapshot";
import { describe, statusJson } from "./src/server/status";
import { ensureIncrementalVacuum, MIGRATIONS, Store, type Db } from "./src/server/store";
import type { BbEvent } from "./src/core/turns";

export { rpcContract };
export type { RpcContract } from "./src/server/rpc";

/** A host call fails after this long, and only the threads on that machine wait. */
const HOST_TIMEOUT_MS = 10_000;
const HISTORY_DAYS = 90;
/** Set only by the drive harness: the plugin's clock may then be moved forward. */
export const DRIVE_ENV = "CACHE_KEEPER_DRIVE_CLOCK";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const httpStatus = (error: unknown) => {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") return status;
  const match = /\bHTTP (\d{3})\b/.exec(message(error));
  return match === null ? null : Number(match[1]);
};

export default async function plugin(bb: BbPluginApi) {
  const settingsHandle = bb.settings.define(SETTINGS);
  let settings: KeeperSettings = parseSettings(await settingsHandle.get());

  const drive = process.env[DRIVE_ENV] === "1" ? new DriveClock() : null;
  const clock: Clock = drive ?? wallClock();

  const db = bb.storage.database() as unknown as Db;
  ensureIncrementalVacuum(db);
  bb.storage.migrate(db as never, MIGRATIONS);
  const store = new Store(db);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const agentTools = new AgentTools(store);

  // ---- prices ----
  let book: PriceBook | null = null;
  const prices = () => {
    book ??= new PriceBook({
      litellm: settings.fetchPrices ? store.getMeta<FetchedPrices>(LITELLM_META)?.models : null,
      modelsDev: settings.fetchPrices ? store.getMeta<FetchedPrices>(MODELS_DEV_META)?.models : null,
      bundled: PINNED_SNAPSHOT.models,
    });
    return book;
  };
  const refreshPrices = async () => {
    if (!settings.fetchPrices) return;
    if (await refreshPublicPrices({ store, fetch, now: () => clock.now(), log: bb.log })) book = null;
  };

  const publish = (threadIds: string[]) => bb.realtime.publish(CHANGED, { threadIds });
  const jumps = () => [...clock.jumps()];

  const engine = new Engine({
    store,
    clock,
    settings: () => settings,
    prices,
    async listThreads() {
      const out: unknown[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = (await bb.sdk.threads.list({ includeHidden: true, offset, limit: 500 })) as unknown[];
        out.push(...page);
        if (page.length < 500) break;
      }
      return out;
    },
    async getThread(threadId) {
      try {
        return await bb.sdk.threads.get({ threadId });
      } catch (error) {
        if (httpStatus(error) === 404) return null;
        throw error;
      }
    },
    async hostOf(threadId) {
      const thread = (await bb.sdk.threads.get({ threadId, include: "environment" })) as { environment?: { hostId?: string } | null };
      return thread.environment?.hostId ?? null;
    },
    pendingInteractions: (threadId) => bb.sdk.threads.interactions.list({ threadId }),
    async queuedMessages(threadId): Promise<QueuedRow[]> {
      const listed = (await bb.sdk.threads.queuedMessages.list({ threadId })) as unknown;
      const rows = Array.isArray(listed) ? listed : ((listed as { messages?: unknown[] }).messages ?? []);
      return rows.map(queuedRowOf);
    },
    async deleteQueued(threadId, queuedMessageId) {
      await bb.sdk.threads.queuedMessages.delete({ threadId, queuedMessageId });
    },
    async contextWindow(threadId) {
      const context = (await bb.sdk.threads.context({ threadId })) as unknown as { usage?: { modelContextWindow?: number } | null };
      return context.usage?.modelContextWindow ?? null;
    },
    async sessionId(threadId) {
      const rows = (await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"], order: "desc", limit: "1" })) as unknown as {
        data?: { providerThreadId?: string };
      }[];
      return rows[0]?.data?.providerThreadId ?? null;
    },
    async events(threadId, afterSeq) {
      const rows = (await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(afterSeq),
        order: "asc",
        limit: String(EVENTS_PAGE),
        types: [...EVENT_TYPES],
      })) as unknown as { seq: number | string; type: string; createdAt: number; data?: unknown }[];
      return rows.map((r): BbEvent => ({ seq: Number(r.seq), type: r.type, createdAt: r.createdAt, data: r.data ?? null }));
    },
    async latestEventSeq(threadId) {
      const rows = (await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "1" })) as unknown as { seq: number | string }[];
      return rows.length === 0 ? 0 : Number(rows[0]!.seq);
    },
    transcript: (hostId, sessionId, cursor) => host.call("transcript", { sessionId, cursor, jumps: jumps() }, { hostId, timeoutMs: HOST_TIMEOUT_MS }),
    tasks: (hostId, input) => host.call("tasks", { ...input, jumps: jumps() }, { hostId, timeoutMs: HOST_TIMEOUT_MS }),
    async retain(hostId, ms) {
      await host.call("retain", { ms }, { hostId, timeoutMs: HOST_TIMEOUT_MS });
    },
    async send(threadId, text) {
      try {
        await bb.sdk.threads.send({ threadId, input: [{ type: "text", text, mentions: [] }], mode: "start", pluginSubmission: { pluginId: bb.pluginId, data: {} } });
        return "sent";
      } catch (error) {
        // bb 0.44 refuses a start on an active thread with 409.
        if (httpStatus(error) === 409) return "busy";
        throw error;
      }
    },
    async markRead(threadId) {
      await bb.sdk.threads.markRead({ threadId });
    },
    async markUnread(threadId) {
      await bb.sdk.threads.markUnread({ threadId });
    },
    publish,
    log: bb.log,
  });

  /** A switch was flipped: the reinstall notice in `status` has done its job. */
  const flipped = () => store.deleteMeta(RESET_META);

  settingsHandle.onChange((next, prev) => {
    settings = parseSettings(next);
    book = null;
    if (next.stalledCheckIns !== prev.stalledCheckIns) flipped();
    if (settings.fetchPrices && prev.fetchPrices === false) void refreshPrices();
    engine.clockMoved();
    publish([]);
  });

  bb.onInstall(async () => {
    const notice = await resetAfterReinstall({ store, engine, agentTools, now: clock.now(), setCheckIns: (on) => settingsHandle.experimental_set({ stalledCheckIns: on }) });
    if (notice !== null) bb.log.info(`reinstalled over stored state: switched off ${notice.threads} thread switch(es), every Skip, the Agent tools and check-ins`);
  });

  // ---- bb's events ----
  const onThread = (event: Parameters<Engine["onThread"]>[0]) => (payload: { thread: unknown }) => {
    try {
      engine.onThread(event, payload.thread);
    } catch (error) {
      bb.log.warn(`${event} event: ${message(error)}`);
    }
  };
  bb.events.on("thread.created", onThread("created"));
  bb.events.on("thread.active", onThread("active"));
  bb.events.on("thread.idle", onThread("idle"));
  bb.events.on("thread.failed", onThread("failed"));
  bb.events.on("thread.archived", onThread("archived"));
  bb.events.on("thread.unarchived", onThread("unarchived"));
  bb.events.on("thread.deleted", onThread("deleted"));
  bb.events.on("interaction.pending", onThread("pending"));
  const onQueued = (event: Parameters<Engine["onQueued"]>[0]) => (payload: { entry: unknown }) => {
    try {
      engine.onQueued(event, payload.entry);
    } catch (error) {
      bb.log.warn(`message.${event} event: ${message(error)}`);
    }
  };
  bb.events.on("message.queued", onQueued("queued"));
  bb.events.on("message.dispatched", onQueued("dispatched"));
  bb.events.on("message.cancelled", onQueued("cancelled"));

  // ---- background work ----
  // Nothing above awaits bb.sdk or a host: bb gives the factory 30 seconds.
  bb.background.service("keeper", {
    async start(signal) {
      await engine.start().catch((error) => bb.log.warn(`could not start: ${message(error)}`));
      await refreshPrices();
      await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));
      engine.stop();
    },
  });
  bb.background.schedule("prices", "17 3 * * *", refreshPrices);
  bb.background.schedule("history", "23 4 * * *", async () => {
    store.prune(clock.now() - HISTORY_DAYS * DAY_MS);
  });

  // ---- RPC ----
  const surfaces = { engine, store, agentTools, now: () => clock.now(), flipped };
  bb.rpc.register(rpcContract, rpcHandlers(surfaces));

  // ---- CLI and agent tool ----
  /** The setting `above` snaps to on the thread, or a refusal that changes nothing. */
  const settingFor = async (threadId: string, above: string): Promise<number> => {
    const size = parseSize(above);
    if (size === null) throw new PluginCliError(`not a size: ${above}`, { code: "bad_size", hint: "Give tokens, e.g. 500k or 0.5m" });
    const view = await engine.viewOf(threadId);
    if (view === null) throw new PluginCliError(`${threadId} is not a Claude Code thread bb lists`, { code: "not_claude_code" });
    return aboveSetting(size, view);
  };

  const usd = (n: number) => `$${n.toFixed(2)}`;

  const toCliError = (error: unknown): never => {
    if (error instanceof PluginCliError) throw error;
    if (error instanceof AboveRefused) throw new PluginCliError(error.message, { code: error.code });
    if (error instanceof ClaudeOnlyError) throw new PluginCliError(error.message, { code: "not_claude_code" });
    if (error instanceof NotReadyError) throw new PluginCliError(error.message, { code: "not_ready" });
    if (error instanceof NoTreeTopError) {
      throw new PluginCliError(error.message, {
        code: "no_tree_top",
        hint: error.below.length === 0 ? "Pass a Claude Code thread" : `Pass one of: ${error.below.map((t) => t.threadId).join(", ")}`,
      });
    }
    throw error;
  };

  /**
   * The thread given, or the current one. Run from inside a thread, a command
   * that changes or sends reaches only threads in the caller's own thread
   * tree; from the user's own terminal, any thread.
   */
  const target = async (input: { positionals: { thread?: string } }, ctx: PluginCliContext, command: string) => {
    const threadId = input.positionals.thread ?? ctx.threadId ?? null;
    if (threadId === null) throw new PluginCliError("no thread given", { code: "missing_thread", hint: `Pass a thread id: bb cache-keeper ${command} thr_…` });
    if (ctx.threadId && ctx.threadId !== threadId && !(await engine.sameTree(ctx.threadId, threadId))) {
      throw new PluginCliError(`${threadId} is not in your thread tree: run from a thread, bb cache-keeper ${command} acts only on threads in the calling thread's own tree`, {
        code: "outside_tree",
        hint: "Run it from the user's terminal to reach any thread",
      });
    }
    return threadId;
  };

  const thread = [{ name: "thread", description: "Thread id (defaults to the current thread)" }] as const;

  const keepWarm = (on: boolean) =>
    cliCommand({
      summary: `Switch keep warm while waiting ${on ? "on" : "off"} for a thread's tree`,
      description:
        "Records the choice on the thread's tree top, the highest Claude Code thread above it or the thread itself, and covers every thread below it. Under Never in Settings the choice is recorded for when the setting changes. Run from a thread, it acts only on threads in that thread's tree.",
      positionals: thread,
      async run(input, ctx) {
        const r = await engine.setKeepWarm(await target(input, ctx, `keep-warm ${on ? "on" : "off"}`), on).catch(toCliError);
        flipped();
        const state = r.never ? `${on ? "on" : "off"}, but keep-warms are off in Settings` : r.keptWarm ? "on" : "off";
        return { exitCode: 0, stdout: `keep warm while waiting: ${state}\ntree top: ${r.treeTop.title} (${r.treeTop.threadId})` };
      },
    });

  const resetLine = () => {
    const notice = store.getMeta<ResetNotice>(RESET_META);
    return notice === null
      ? []
      : [`Reinstalled: every thread's Compact when idle, every tree's Keep warm while waiting, every Skip, the Agent tools and check-ins were switched off (${new Date(notice.at).toISOString()}).`, ""];
  };

  const commands: Parameters<typeof defineCli>[0]["commands"] = {
    on: cliCommand({
      summary: "Switch compact-when-idle on for a thread",
      description: "Run from a thread, it acts only on threads in that thread's tree.",
      positionals: thread,
      options: { above: { type: "string", description: "Compaction line, e.g. 500k: snapped to the nearest of the thread's ten lines; refused while the thread's window is unknown or above its highest line" } },
      async run(input, ctx) {
        const threadId = await target(input, ctx, "on");
        const setting = input.options.above === undefined ? undefined : await settingFor(threadId, input.options.above).catch(toCliError);
        const view = await engine.setCompact(threadId, true, setting).catch(toCliError);
        flipped();
        if (view === null) return { exitCode: 0, stdout: "on" };
        if (setting !== undefined) return { exitCode: 0, stdout: `on, line set to ${formatSize(view.line)} (setting ${view.setting} of 10)` };
        return { exitCode: 0, stdout: view.windowKnown ? `on, at ${formatSize(view.line)}` : "on; no line until bb reports the thread's context window, once its first turn ends" };
      },
    }),
    off: cliCommand({
      summary: "Switch compact-when-idle off for a thread",
      description: "Run from a thread, it acts only on threads in that thread's tree.",
      positionals: thread,
      async run(input, ctx) {
        await engine.setCompact(await target(input, ctx, "off"), false).catch(toCliError);
        flipped();
        return { exitCode: 0, stdout: "off" };
      },
    }),
    "compact-now": cliCommand({
      summary: "Compact a thread now, whatever its size or Compact when idle, if it is idle and not waiting",
      description: "Run from a thread, it acts only on threads in that thread's tree.",
      positionals: thread,
      async run(input, ctx) {
        await engine.compactNow(await target(input, ctx, "compact-now")).catch(toCliError);
        return { exitCode: 0, stdout: "compacting" };
      },
    }),
    "keep-warm on": keepWarm(true),
    "keep-warm off": keepWarm(false),
    status: cliCommand({
      summary: "Show a thread's line, status and Cache Keeper's last decision, or every switched-on thread and the 30-day totals",
      positionals: [{ name: "thread", description: "Thread id; without one, lists every thread with compact-when-idle on" }],
      options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
      async run(input) {
        const now = clock.now();
        const threadId = input.positionals.thread;
        const reset = store.getMeta<ResetNotice>(RESET_META);
        const priceError = refreshError(store);
        if (threadId !== undefined) {
          const view = await engine.viewOf(threadId);
          if (view === null) throw new PluginCliError(`${threadId} is not a Claude Code thread bb lists`, { code: "not_claude_code" });
          if (input.options.json === true) return { exitCode: 0, stdout: JSON.stringify(statusJson(view, now, priceError, reset), null, 2) };
          return { exitCode: 0, stdout: [...resetLine(), describe(view, now, priceError)].join("\n") };
        }
        const on = engine.switchedOn();
        const totals = engine.totals(30);
        if (input.options.json === true) return { exitCode: 0, stdout: JSON.stringify({ reset, threads: on.map((v) => statusJson(v, now, priceError, null)), totals }, null, 2) };
        const lines = [...resetLine(), ...(on.length === 0 ? ["No thread has compact-when-idle on."] : on.map((v) => describe(v, now, priceError)))];
        lines.push(
          "",
          "Last 30 days:",
          `  compactions: ${totals.compactions}, ${usd(totals.compactionUsd)}`,
          `  keep-warms and check-ins: ${totals.keepWarms} and ${totals.checkIns}, ${usd(totals.warmUsd)}`,
          `  cold rewrites avoided on first messages back: ${usd(totals.avoidedUsd)}`,
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      },
    }),
  };

  if (drive !== null) {
    commands["drive advance"] = cliCommand({
      summary: "Move Cache Keeper's clock forward (drive harness only)",
      hidden: true,
      positionals: [{ name: "duration", description: "How far, e.g. 4m or 90s", required: true }],
      async run(input) {
        const ms = parseDuration(input.positionals.duration);
        if (ms === null) throw new PluginCliError(`not a duration: ${input.positionals.duration}`, { code: "bad_duration" });
        drive.advance(ms);
        engine.clockMoved();
        return { exitCode: 0, stdout: `clock ${new Date(clock.now()).toISOString()}` };
      },
    });
    commands["drive now"] = cliCommand({
      summary: "Print Cache Keeper's clock (drive harness only)",
      hidden: true,
      async run() {
        await engine.idle();
        return { exitCode: 0, stdout: JSON.stringify({ now: clock.now(), iso: new Date(clock.now()).toISOString(), offsetAtNow: onClock(clock.jumps(), Date.now()) - Date.now() }) };
      },
    });
  }

  bb.cli.register(
    defineCli({
      name: "cache-keeper",
      summary: "Compact idle Claude Code threads before their cache goes cold",
      description:
        "Switch compact-when-idle on or off for a thread, compact it now, or see its compaction line, status and Cache Keeper's last decision; switch keep warm while waiting on or off for a thread's tree. Run from inside a thread, the commands that change or send reach only threads in that thread's tree. Which trees are kept warm until switched is set by \"Keep caches warm while waiting\" in Settings (default: only threads switched on); check-ins on stalled background work run on every Claude Code thread while \"Check in on stalled background work\" is on (default: off).",
      commands,
    }),
  );

  bb.agents.registerTool({
    name: AGENT_TOOLS.compactWhenIdle.name,
    description:
      "Switch Cache Keeper's compact-when-idle on for this thread: when its turn ends at or above the compaction line, it is compacted a minute before its prompt cache expires. Optionally set the line as a size such as 500k; it is refused while the thread's context window is unknown, or above its highest line.",
    presentation: { label: { pending: "Switching on compact when idle", completed: "Switched on compact when idle" } },
    parameters: z.object({ above: z.string().optional().describe("Compaction line in tokens, e.g. 500k or 0.5m; snapped to the nearest of the thread's ten lines") }).strict(),
    execute: ({ above }, { threadId }) => compactWhenIdle(surfaces, threadId, above),
  });
  bb.agents.configure(() => ({ tools: agentTools.offered(), skills: [] }));
}

/** "4m", "90s", "1h", "250ms", or a bare number of seconds, in milliseconds. */
function parseDuration(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/.exec(text);
  if (m === null) return null;
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: DAY_MS }[(m[2] ?? "s") as "ms" | "s" | "m" | "h" | "d"];
  const ms = Number(m[1]) * unit;
  return ms > 0 ? ms : null;
}

export type { ThreadView };
