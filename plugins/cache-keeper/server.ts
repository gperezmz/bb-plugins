// Cache Keeper's backend entry: wires bb's threads, events, settings, storage
// and host entry to the engine under src/server, and registers the RPC, the
// CLI and the agent tool.
import { cliCommand, defineCli, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { formatSize, parseSize, snapSetting } from "./src/core/line";
import { PriceBook } from "./src/core/pricing";
import { CHANGED, rowStatus, statusText, type RowGlyph, type ThreadView } from "./src/core/view";
import { hostContract } from "./src/host/contract";
import { TURN_EVENT_TYPES, type BbEvent } from "./src/core/turns";
import { ClaudeOnlyError, DAY_MS, Engine, EVENTS_PAGE, NotReadyError, type ListedThread, type QueuedRow, type TaskEvent } from "./src/server/engine";
import { LITELLM_META, MODELS_DEV_META, refreshPublicPrices, type FetchedPrices } from "./src/server/public-prices";
import { rpcContract, type Overview } from "./src/server/rpc";
import { parseSettings, SETTINGS, type KeeperSettings } from "./src/server/settings";
import { PINNED_SNAPSHOT } from "./src/server/snapshot";
import { MIGRATIONS, Store, type Db } from "./src/server/store";

export { rpcContract };
export type { RpcContract } from "./src/server/rpc";

const PASS_MS = 15_000;
/** Nothing is run sooner than this after the last pass, however soon a send falls due. */
const MIN_SLEEP_MS = 250;
const HOST_TIMEOUT_MS = 20_000;
const HISTORY_DAYS = 90;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default async function plugin(bb: BbPluginApi) {
  const settingsHandle = bb.settings.define(SETTINGS);
  let settings: KeeperSettings = parseSettings(await settingsHandle.get());

  const db = bb.storage.database() as unknown as Db;
  bb.storage.migrate(db as never, MIGRATIONS);
  const store = new Store(db);
  const host = bb.hosts.experimental_client({ contract: hostContract });

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
    if (await refreshPublicPrices({ store, fetch, now: Date.now, log: bb.log })) book = null;
  };

  const publish = (threadIds: string[]) => bb.realtime.publish(CHANGED, { threadIds });

  const sessions = new Map<string, { id: string | null; at: number }>();
  const engine = new Engine({
    store,
    now: () => Date.now(),
    settings: () => settings,
    prices,
    async listThreads() {
      const out: ListedThread[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = (await bb.sdk.threads.list({ includeHidden: true, offset, limit: 500 })) as unknown as ListedThread[];
        out.push(...page);
        if (page.length < 500) break;
      }
      return out;
    },
    async queuedMessages(threadId): Promise<QueuedRow[]> {
      const listed = (await bb.sdk.threads.queuedMessages.list({ threadId })) as unknown;
      const rows = (Array.isArray(listed) ? listed : ((listed as { messages?: unknown[] }).messages ?? [])) as {
        id: string;
        sendAt: number | null;
        createdAt: number;
        failureReason: string | null;
        initiator: string;
        content: unknown[];
      }[];
      return rows.map((r) => ({
        id: r.id,
        sendAt: r.sendAt,
        createdAt: r.createdAt,
        failed: r.failureReason !== null,
        system: r.initiator === "system",
        content: Array.isArray(r.content) ? r.content : [],
      }));
    },
    async deleteQueued(threadId, queuedMessageId) {
      await bb.sdk.threads.queuedMessages.delete({ threadId, queuedMessageId });
    },
    async contextWindow(threadId) {
      const context = (await bb.sdk.threads.context({ threadId })) as unknown as { usage?: { modelContextWindow?: number } | null };
      return context.usage?.modelContextWindow ?? null;
    },
    // The Claude Code session id, from bb's latest thread/identity event; re-read every few minutes.
    async sessionId(threadId) {
      const known = sessions.get(threadId);
      if (known !== undefined && Date.now() - known.at < 5 * 60_000) return known.id;
      const rows = (await bb.sdk.threads.events.list({ threadId, types: ["thread/identity"], order: "desc", limit: "1" })) as unknown as {
        data?: { providerThreadId?: string };
      }[];
      const id = rows[0]?.data?.providerThreadId ?? null;
      sessions.set(threadId, { id, at: Date.now() });
      return id;
    },
    async taskEvents(threadId, afterSeq) {
      const rows = (await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(afterSeq),
        order: "asc",
        limit: String(EVENTS_PAGE),
        types: ["item/started", "item/backgroundTask/progress", "item/backgroundTask/completed"],
      })) as unknown as { seq: number | string; type: string; createdAt: number; data?: { item?: TaskEvent["item"] } }[];
      return rows.map((r) => ({ seq: Number(r.seq), type: r.type, createdAt: r.createdAt, item: r.data?.item ?? null }));
    },
    async turnEvents(threadId, afterSeq) {
      const rows = (await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(afterSeq),
        order: "asc",
        limit: String(EVENTS_PAGE),
        types: [...TURN_EVENT_TYPES],
      })) as unknown as { seq: number | string; type: string; createdAt: number; data?: unknown }[];
      return rows.map((r): BbEvent => ({ seq: Number(r.seq), type: r.type, createdAt: r.createdAt, data: r.data ?? null }));
    },
    async latestEventSeq(threadId) {
      const rows = (await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "1" })) as unknown as { seq: number | string }[];
      return rows.length === 0 ? 0 : Number(rows[0]!.seq);
    },
    transcript: (hostId, sessionId, requestsSince) => host.call("transcript", { sessionId, requestsSince }, { hostId, timeoutMs: HOST_TIMEOUT_MS }),
    tasks: (hostId, input) => host.call("tasks", input, { hostId, timeoutMs: HOST_TIMEOUT_MS }),
    async send(threadId, text, marker) {
      await bb.sdk.threads.send({
        threadId,
        input: [{ type: "text", text, mentions: [] }],
        mode: "start",
        pluginSubmission: { pluginId: bb.pluginId, data: { kind: marker.kind, sendId: marker.sendId } },
      });
    },
    async readState(threadId) {
      const thread = (await bb.sdk.threads.get({ threadId })) as unknown as { lastReadAt: number | null; latestAttentionAt: number | null };
      return { lastReadAt: thread.lastReadAt ?? null, latestAttentionAt: thread.latestAttentionAt ?? null };
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

  settingsHandle.onChange(async (next) => {
    const before = settings;
    settings = parseSettings(next);
    book = null;
    if (settings.fetchPrices && !before.fetchPrices) void refreshPrices();
    void engine.pass().then(() => publish([]));
  });

  // ---- bb's thread events ----
  bb.events.on("thread.active", ({ thread }) => {
    const id = (thread as { id: string }).id;
    void engine.onActive(id).catch((error) => bb.log.warn(`active ${id}: ${message(error)}`));
  });
  bb.events.on("thread.idle", ({ thread }) => {
    void engine.onIdle((thread as { id: string }).id).catch((error) => bb.log.warn(`idle ${(thread as { id: string }).id}: ${message(error)}`));
  });

  // ---- background work ----
  // Nothing above awaits bb.sdk or a host: bb gives the factory 30 seconds.
  // A pass runs every 15 seconds, and at the moment the next send falls due.
  bb.background.service("keeper", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await engine.pass();
        } catch (error) {
          bb.log.warn(`pass failed: ${message(error)}`);
        }
        // A pass run for bb's thread.idle may bring the next send forward, so the wait is checked every second.
        const pollUntil = Date.now() + PASS_MS;
        while (!signal.aborted) {
          const wake = engine.wakeAt();
          const until = Math.min(pollUntil, wake === null ? Infinity : Math.max(wake, Date.now() + MIN_SLEEP_MS));
          if (Date.now() >= until) break;
          await sleep(Math.min(1_000, until - Date.now()), signal);
        }
      }
    },
  });
  // Once a day, and at startup when the stored copy is older than that; a failure is retried hourly.
  bb.background.service("prices", {
    async start(signal) {
      while (!signal.aborted) {
        await refreshPrices();
        await sleep(60 * 60_000, signal);
      }
    },
  });
  bb.background.schedule("history", "23 4 * * *", async () => {
    store.pruneHistory(Date.now() - HISTORY_DAYS * DAY_MS);
  });

  // ---- RPC ----
  const overview = async (): Promise<Overview> => {
    const views = engine.allViews();
    const recent = store
      .history(Date.now() - 30 * DAY_MS, 50)
      .filter((h) => h.kind !== "return")
      .map((h) => ({ ...h, title: engine.titleOf(h.threadId) }));
    const titles: Record<string, string> = {};
    for (const h of recent) for (const id of Object.keys(h.record.split ?? {})) titles[id] = engine.titleOf(id);
    return {
      switchedOn: await engine.switchedOn(),
      waiting: views.filter((v) => v.waiting && v.checkIns && v.status === "idle"),
      recent,
      titles,
      totals: engine.totals(30),
      checkIns: settings.checkIns,
    };
  };

  const rpcError = (error: unknown): never => {
    if (error instanceof ClaudeOnlyError || error instanceof NotReadyError) throw new Error(error.message);
    throw error;
  };

  bb.rpc.register(rpcContract, {
    view: ({ threadId }) => engine.viewOf(threadId),
    setCompact: ({ threadId, on, setting }) => engine.setCompact(threadId, on, setting).catch(rpcError),
    setSetting: ({ threadId, setting }) => engine.setSetting(threadId, setting).catch(rpcError),
    skip: ({ threadId, what, undo }) => engine.skip(threadId, what, undo),
    compactNow: ({ threadId }) => engine.compactNow(threadId).catch(rpcError),
    rowStatuses: async () =>
      engine
        .allViews()
        .map((v) => ({ threadId: v.threadId, status: rowStatus(v) }))
        .filter((r): r is RowGlyph => r.status !== null),
    overview,
  });

  // ---- CLI and agent tool ----
  const settingFor = async (threadId: string, above: string | undefined): Promise<number | undefined> => {
    if (above === undefined) return undefined;
    const size = parseSize(above);
    if (size === null) throw new PluginCliError(`not a size: ${above}`, { code: "bad_size", hint: "Give tokens, e.g. 500k or 0.5m" });
    const view = await engine.viewOf(threadId);
    // With no line known yet (no transcript or price), the thread keeps its setting.
    if (view === null || view.lines.every((l) => l === null)) return undefined;
    return snapSetting(size, view.lines);
  };

  const describe = (v: ThreadView, now: number) =>
    [
      `${v.title} (${v.threadId})`,
      `  compact when idle: ${v.compactOn ? "on" : "off"}`,
      `  line: ${formatSize(v.line)}`,
      `  context: ${v.context === null ? "unknown" : formatSize(v.context)}`,
      `  status: ${statusText(v, now)}`,
      `  rests on: ${v.model ?? "unknown model"}, ${v.lifetime === null ? "unknown" : v.lifetime === "5m" ? "5-minute" : "1-hour"} cache, ${v.callsPerMessage.toFixed(1)} calls per message${v.callsMeasured ? "" : " (default)"}, ${formatSize(v.postCompaction)} after compacting${v.postMeasured ? "" : " (default)"}`,
    ].join("\n");

  const usd = (n: number) => `$${n.toFixed(2)}`;

  const toCliError = (error: unknown): never => {
    if (error instanceof ClaudeOnlyError) throw new PluginCliError(error.message, { code: "not_claude_code" });
    if (error instanceof NotReadyError) throw new PluginCliError(error.message, { code: "not_ready" });
    throw error;
  };

  const target = (input: { positionals: { thread?: string } }, ctx: { threadId?: string | null }) => {
    const threadId = input.positionals.thread ?? ctx.threadId ?? null;
    if (threadId === null) throw new PluginCliError("no thread given", { code: "missing_thread", hint: "Pass a thread id: bb cache-keeper status thr_…" });
    return threadId;
  };

  const thread = [{ name: "thread", description: "Thread id (defaults to the current thread)" }] as const;

  bb.cli.register(
    defineCli({
      name: "cache-keeper",
      summary: "Compact idle Claude Code threads before their cache goes cold",
      description:
        "Switch compact-when-idle on or off for a thread, compact it now, or see its compaction line and status. Keep-warms and check-ins run on every Claude Code thread while \"Check in on background work\" is on.",
      commands: {
        on: cliCommand({
          summary: "Switch compact-when-idle on for a thread",
          positionals: thread,
          options: { above: { type: "string", description: "Compaction line, e.g. 500k; snapped to the nearest setting" } },
          async run(input, ctx) {
            const threadId = target(input, ctx);
            const view = await engine.setCompact(threadId, true, await settingFor(threadId, input.options.above).catch(toCliError)).catch(toCliError);
            return { exitCode: 0, stdout: view === null ? "on" : `on, at ${formatSize(view.line)}` };
          },
        }),
        off: cliCommand({
          summary: "Switch compact-when-idle off for a thread",
          positionals: thread,
          async run(input, ctx) {
            await engine.setCompact(target(input, ctx), false).catch(toCliError);
            return { exitCode: 0, stdout: "off" };
          },
        }),
        now: cliCommand({
          summary: "Compact a thread now, whatever its size, if it is idle and not waiting",
          positionals: thread,
          async run(input, ctx) {
            await engine.compactNow(target(input, ctx)).catch(toCliError);
            return { exitCode: 0, stdout: "compacting" };
          },
        }),
        status: cliCommand({
          summary: "Show a thread's line and status, or every switched-on thread and the 30-day totals",
          positionals: [{ name: "thread", description: "Thread id; without one, lists every thread with compact-when-idle on" }],
          options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
          async run(input) {
            const now = Date.now();
            const threadId = input.positionals.thread;
            if (threadId !== undefined) {
              const view = await engine.viewOf(threadId);
              if (view === null) throw new PluginCliError(`${threadId} is not a Claude Code thread bb lists`, { code: "not_claude_code" });
              return { exitCode: 0, stdout: input.options.json === true ? JSON.stringify({ ...view, statusText: statusText(view, now) }, null, 2) : describe(view, now) };
            }
            const on = await engine.switchedOn();
            const totals = engine.totals(30);
            if (input.options.json === true) return { exitCode: 0, stdout: JSON.stringify({ threads: on, totals }, null, 2) };
            const lines = on.length === 0 ? ["No thread has compact-when-idle on."] : on.map((v) => describe(v, now));
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
      },
    }),
  );

  bb.agents.registerTool({
    name: "cache_keeper_compact_when_idle",
    description:
      "Switch Cache Keeper's compact-when-idle on for this thread: when its turn ends at or above the compaction line, it is compacted a minute before its prompt cache expires. Optionally set the line as a size such as 500k.",
    presentation: { label: { pending: "Switching on compact when idle", completed: "Switched on compact when idle" } },
    parameters: z.object({ above: z.string().optional().describe("Compaction line in tokens, e.g. 500k or 0.5m; snapped to the nearest setting") }).strict(),
    async execute({ above }, { threadId }) {
      try {
        const view = await engine.setCompact(threadId, true, await settingFor(threadId, above));
        return JSON.stringify({ on: true, line: formatSize(view?.line ?? null), context: view?.context ?? null });
      } catch (error) {
        return JSON.stringify({ on: false, error: message(error) });
      }
    },
  });
}
