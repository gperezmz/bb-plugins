// Thread Usage backend entry. Wires bb's events, settings, storage and host
// entry to the pure modules under src/core and the engine under src/server.
import "./src/zod-locale";
import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import * as z from "zod/mini";
import { PriceBook } from "./src/core/pricing";
import { turnsCsv } from "./src/core/export";
import { topText } from "./src/core/format";
import { costTotal, figureTokenCount } from "./src/core/summary";
import { hostContract } from "./src/host/contract";
import { Engine, PANEL_LOG_TIMEOUT_MS, type ThreadDto } from "./src/server/engine";
import { UsageModel } from "./src/server/model";
import { rpcContract } from "./src/server/rpc";
import { parseSettings, SETTINGS, type UsageSettings } from "./src/server/settings";
import {
  flipRefreshPricesDefault,
  refreshError,
  refreshPublicPrices,
  storedPrices,
  type FetchedPrices,
} from "./src/server/public-prices";
import { PINNED_SNAPSHOT } from "./src/server/snapshot";
import { MIGRATIONS, Store, type Db } from "./src/server/store";
import type { SettingsStatus } from "./src/core/report-types";
import type { LedgerEvent } from "./src/core/ledger";

export { rpcContract };
export type { RpcContract } from "./src/server/rpc";

const RETENTION_MS = 365 * 86_400_000;
/** Bump when a ledger rule changes; stored ledgers are then rebuilt from bb's events. */
const LEDGER_VERSION = 4;
/** Set once Claude Code threads seen before main-session cache writes were kept have had their logs read again. */
const CACHE_WRITES_META = "cacheWritesReread";
const DAY_MS = 86_400_000;

/** When the public prices were last fetched, as an ISO time; null when never. */
const pricesUpdatedAt = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settingsHandle = bb.settings.define(SETTINGS);
  // Cached for the synchronous env resolver; refreshed on every save.
  let settings: UsageSettings = parseSettings(await settingsHandle.get());
  const readSettings = async () => {
    settings = parseSettings(await settingsHandle.get());
    return settings;
  };

  const db = bb.storage.database() as unknown as Db;
  bb.storage.migrate(db as never, MIGRATIONS);
  const store = new Store(db);
  const host = bb.hosts.experimental_client({ contract: hostContract });

  // ---- prices ----
  // Refresh prices online is on by default. It used to be off, so a stored
  // false is flipped once (see flipRefreshPricesDefault).
  if (await flipRefreshPricesDefault(store, settings.refreshPrices, () => settingsHandle.experimental_set({ refreshPrices: null }).then(() => undefined), bb.log)) {
    await readSettings();
    bb.log.info("Refresh prices online is now on by default; a stored \"off\" from before was reset");
  }
  let priceBook: PriceBook | null = null;
  // The fetched models.dev list, read from the store once per refresh; none while the setting is off.
  let fetched: { list: FetchedPrices | null } | null = null;
  const fetchedList = (): FetchedPrices | null => {
    if (!settings.refreshPrices) return null;
    fetched ??= { list: storedPrices(store) };
    return fetched.list;
  };
  // The fetched list, else the one bundled with the plugin.
  const prices = (): PriceBook => {
    priceBook ??= new PriceBook(
      fetchedList() === null
        ? { models: PINNED_SNAPSHOT.models, origin: "snapshot" }
        : { models: (fetchedList() as FetchedPrices).models, origin: "models.dev" },
    );
    return priceBook;
  };
  const pricesChanged = () => {
    fetched = null;
    priceBook = null;
    model.invalidateAll();
    bb.realtime.publish("usage-changed", { threadIds: [] });
  };
  const refreshPrices = async () => {
    if (!settings.refreshPrices) return;
    const failing = refreshError(store);
    // A change in what failed also changes the reports' "refresh failed" note.
    if ((await refreshPublicPrices({ store, fetch, now: Date.now, log: bb.log })) || refreshError(store) !== failing) pricesChanged();
  };

  const model: UsageModel = new UsageModel({
    store,
    settings: () => settings,
    prices,
    pricesMeta: () => ({
      modelsDevAt: fetchedList()?.fetchedAtMs ?? null,
      bundledDate: PINNED_SNAPSHOT.fetchedAt,
      refreshOn: settings.refreshPrices,
      lastError: settings.refreshPrices ? refreshError(store) : null,
    }),
    now: () => Date.now(),
  });

  const engine: Engine = new Engine({
    store,
    model,
    settings: () => settings,
    now: () => Date.now(),
    async listEvents({ threadId, afterSeq, types, limit }) {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(afterSeq),
        limit: String(limit),
        order: "asc",
        types: types as never,
      });
      return rows as unknown as LedgerEvent[];
    },
    async getThread(threadId) {
      try {
        return (await bb.sdk.threads.get({ threadId })) as unknown as ThreadDto;
      } catch {
        return null;
      }
    },
    async listThreads(offset, limit) {
      return (await bb.sdk.threads.list({ includeHidden: true, offset, limit })) as unknown as ThreadDto[];
    },
    async hostIdForEnvironment(environmentId) {
      const env = (await bb.sdk.environments.get({ environmentId })) as unknown as {
        hostId?: string | null;
        environment?: { hostId?: string | null };
      };
      return env.hostId ?? env.environment?.hostId ?? null;
    },
    async hostName(hostId) {
      const h = (await bb.sdk.hosts.get({ hostId })) as unknown as { name?: string; host?: { name?: string } };
      return h.name ?? h.host?.name ?? hostId;
    },
    async readLogs(hostId, input, timeoutMs) {
      return host.call("readSessionLogs", input, { hostId, timeoutMs });
    },
    publish: (channel, payload) => bb.realtime.publish(channel, payload),
    log: bb.log,
  });

  settingsHandle.onChange(async () => {
    const before = settings;
    await readSettings();
    pricesChanged();
    if (settings.refreshPrices && !before.refreshPrices) void refreshPrices();
    if (settings.warnAbove !== before.warnAbove) engine.checkAllBudgets();
  });

  // ---- lifecycle events ----
  bb.events.on("experimental_thread.events", ({ thread, sequence }) => {
    const dto = thread as unknown as ThreadDto;
    engine.recordThread(dto);
    engine.catchUpSoon(dto.id, sequence);
  });
  bb.events.on("thread.created", ({ thread }) => {
    const dto = thread as unknown as ThreadDto;
    engine.recordThread(dto);
    if (store.getThread(dto.id) === null) {
      const now = Date.now();
      store.putThread(
        {
          threadId: dto.id,
          cursor: {
            lastSeq: 0,
            lastTotal: null,
            firstSeenAt: now,
            pending: {},
            sessionIds: [],
            routing: [],
            rateLimitKind: null,
            lastModel: null,
          },
          firstSeenAt: now,
          gaps: [],
          historyBackfilled: false,
          logsReadThrough: null,
          logsMissingHost: null,
          logsMissingSince: null,
          lastActivityAt: now,
        },
        now,
      );
    }
    engine.changed([dto.id]);
  });
  bb.events.on("thread.active", ({ thread }) => {
    engine.recordThread(thread as unknown as ThreadDto);
  });
  bb.events.on("thread.idle", async ({ thread }) => {
    const dto = thread as unknown as ThreadDto;
    engine.recordThread(dto);
    store.upsertEdge({ threadId: dto.id, idleSince: Date.now() }, Date.now());
    await engine.catchUpQuietly(dto.id);
    await engine.readThreadLogs(dto.id, { timeoutMs: PANEL_LOG_TIMEOUT_MS * 6 });
  });
  bb.events.on("thread.failed", ({ thread }) => {
    engine.recordThread(thread as unknown as ThreadDto);
    void engine.catchUpQuietly((thread as unknown as ThreadDto).id);
  });
  for (const name of ["thread.archived", "thread.unarchived"] as const) {
    bb.events.on(name, ({ thread }) => {
      const dto = thread as unknown as ThreadDto;
      engine.recordThread(dto);
      if (name === "thread.unarchived") store.upsertEdge({ threadId: dto.id, archivedAt: null }, Date.now());
      engine.changed([dto.id]);
    });
  }
  bb.events.on("thread.deleted", ({ thread }) => {
    void engine.onDeleted(thread as unknown as ThreadDto);
  });

  // ---- background work ----
  // Nothing above awaits bb.sdk, the network or the logs: bb gives the factory
  // 30 seconds, and on a server that has just started bb.sdk can take all of
  // them to answer. What needs them runs in the services below.
  bb.background.service("backfill", {
    async start(signal) {
      store.requeueRunning(Date.now());
      // Read before discovery records bb's current status over it.
      const wasRunning = store.allEdges().filter((e) => e.status === "active" && e.deletedAt === null).map((e) => e.threadId);
      try {
        const listed = await engine.discover();
        // Rebuild after discovery, so only threads bb still lists lose their ledgers.
        if (store.getMeta<number>("ledgerVersion") !== LEDGER_VERSION) {
          await engine.rebuildLedgers(listed);
          store.setMeta("ledgerVersion", LEDGER_VERSION);
        }
        if (store.getMeta<boolean>(CACHE_WRITES_META) !== true) {
          engine.rereadClaudeLogs(listed);
          store.setMeta(CACHE_WRITES_META, true);
        }
        bb.log.info(`discovered ${listed.size} threads`);
        await engine.resumeInterrupted(wasRunning.filter((id) => listed.has(id)));
      } catch (error) {
        bb.log.warn(`thread discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      engine.checkAllBudgets();
      while (!signal.aborted) {
        const ran = await engine.runBackfill(2);
        if (ran > 0) bb.realtime.publish("backfill-changed", store.queueCounts());
        await sleep(ran > 0 ? 250 : 15_000, signal);
      }
    },
  });
  bb.background.service("logs-retry", {
    async start(signal) {
      while (!signal.aborted) {
        await sleep(15 * 60_000, signal);
        if (!signal.aborted) await engine.retryMissingLogs();
      }
    },
  });
  // Once a day, and at startup when the stored copy is older than that; a failure is retried hourly.
  bb.background.service("online-prices", {
    async start(signal) {
      while (!signal.aborted) {
        await refreshPrices();
        await sleep(60 * 60_000, signal);
      }
    },
  });
  bb.background.schedule("retention", "17 3 * * *", async () => {
    const collapsed = store.collapseBefore(Date.now() - RETENTION_MS);
    if (collapsed > 0) {
      model.invalidateAll();
      bb.log.info(`collapsed old records of ${collapsed} threads`);
    }
  });
  bb.onDispose(() => engine.dispose());

  // ---- RPC ----
  const status = (): SettingsStatus => {
    const list = fetchedList();
    const counts = store.queueCounts();
    return {
      prices: {
        ...model.pricesInfo(),
        models: Object.keys(list?.models ?? PINNED_SNAPSHOT.models).length,
      },
      backfill: {
        ...counts,
        paused: engine.paused(),
        failures: store.failedJobs(5).map((j) => ({ threadId: j.threadId, kind: j.kind, error: j.lastError })),
      },
      logsMissing: store
        .threadsWithMissingLogs()
        .map((t) => ({ threadId: t.threadId, host: t.logsMissingHost ?? "", since: t.logsMissingSince ?? 0 })),
      threadsTracked: store.edgeCount(),
    };
  };

  const treeIdsOf = (threadId: string): string[] => {
    const index = model.index();
    const out: string[] = [];
    const walk = (id: string) => {
      out.push(id);
      for (const c of index.children.get(id) ?? []) if (!out.includes(c.threadId)) walk(c.threadId);
    };
    walk(threadId);
    return out;
  };

  bb.rpc.register(rpcContract, {
    async report({ threadId }) {
      await readSettings();
      if (store.getEdge(threadId) === null) {
        const dto = await bb.sdk.threads.get({ threadId }).catch(() => null);
        if (dto !== null) engine.recordThread(dto as unknown as ThreadDto);
      }
      if (store.getThread(threadId) === null) await engine.catchUp(threadId);
      return model.report(threadId);
    },
    async chip({ threadId }) {
      await readSettings();
      if (store.getThread(threadId) === null && store.getEdge(threadId) === null) {
        const dto = await bb.sdk.threads.get({ threadId }).catch(() => null);
        if (dto !== null) engine.recordThread(dto as unknown as ThreadDto);
        await engine.catchUp(threadId);
      }
      return model.chip(threadId);
    },
    claimToast({ rootThreadId, amount }) {
      return { claimed: store.claimToast(rootThreadId, amount, Date.now()) };
    },
    async refresh({ threadId }) {
      await readSettings();
      // Opening the tab also retries machines that were offline.
      await engine.refresh(treeIdsOf(threadId));
      return { ok: true };
    },
    async top({ projectId, sinceDays }) {
      await readSettings();
      const trees = model.top(projectId, Date.now() - sinceDays * DAY_MS);
      let projects: { id: string; name: string }[] = [];
      try {
        const listed = (await bb.sdk.projects.list()) as unknown as { id: string; name: string }[];
        projects = listed.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        projects = [];
      }
      return { trees, projects, prices: model.pricesInfo() };
    },
    async status() {
      await readSettings();
      return status();
    },
    async backfill({ action }) {
      if (action === "pause") engine.setPaused(true);
      if (action === "resume") engine.setPaused(false);
      if (action === "retry-failed") {
        for (const job of store.failedJobs(1000)) {
          store.enqueue({ threadId: job.threadId, kind: job.kind, fromMs: null, toMs: null, priority: 0 }, Date.now());
        }
      }
      return status();
    },
    async exportAll() {
      await readSettings();
      const edges = store.allEdges();
      const threads = edges.map((edge) => {
        const report = model.report(edge.threadId);
        return {
          threadId: edge.threadId,
          // A title bb built from the first prompt is prompt text: left out.
          title: edge.titleFromPrompt ? null : edge.title,
          providerId: edge.providerId,
          projectId: edge.projectId,
          parentThreadId: edge.parentThreadId,
          sourceThreadId: edge.sourceThreadId,
          deletedAt: edge.deletedAt,
          total: {
            usd: costTotal(report.thread.figure.cost),
            cost: report.thread.figure.cost,
            tokens: report.thread.figure.tokens,
            billing: report.billing,
          },
          // Prompt lines stay in the panel; exports carry no prompt text.
          turns: store.getTurns(edge.threadId).map(({ prompt: _prompt, ...turn }) => turn),
          report,
        };
      });
      const csv = threads
        .map((t, i) => {
          const text = turnsCsv(t.report.turns, {
            header: ["thread_id", "thread_title", "provider"],
            cells: [t.threadId, t.title ?? "", t.providerId ?? ""],
          });
          return i === 0 ? text : text.slice(text.indexOf("\n") + 1);
        })
        .join("");
      const json = JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          threads: threads.map(({ report: _report, ...rest }) => rest),
        },
        null,
        2,
      );
      return { json, csv, threads: threads.length };
    },
  });

  // ---- CLI ----
  bb.cli.register(
    defineCli({
      name: "thread-usage",
      summary: "Show what a bb thread and the threads it spawned cost",
      description:
        "Cost and tokens per thread, rolled up over child threads. Cost is an estimate from models.dev prices; tokens no price covers are counted and not priced.",
      commands: {
        show: cliCommand({
          summary: "Show a thread's usage, with its children by default",
          positionals: [{ name: "threadId", description: "Thread id (defaults to the current thread)" }],
          options: {
            "no-children": { type: "boolean", description: "Only this thread, without its descendants" },
            json: { type: "boolean", description: "Emit machine-readable JSON" },
          },
          async run(input, ctx) {
            await readSettings();
            const threadId = input.positionals.threadId ?? ctx.threadId;
            if (threadId === undefined || threadId === null) {
              throw new PluginCliError("no thread id given", {
                code: "missing_thread",
                hint: "Pass a thread id: bb thread-usage show thr_…",
              });
            }
            if (store.getEdge(threadId) === null) {
              const dto = await bb.sdk.threads.get({ threadId }).catch(() => null);
              if (dto === null) {
                throw new PluginCliError(`no thread ${threadId}`, { code: "thread_not_found" });
              }
              engine.recordThread(dto as unknown as ThreadDto);
            }
            await engine.catchUp(threadId);
            const withChildren = input.options["no-children"] !== true;
            if (input.options.json === true) {
              const report = model.report(threadId);
              const view = withChildren ? report.treeTotal : report.thread;
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  {
                    threadId,
                    title: report.title,
                    scope: withChildren ? "tree" : "thread",
                    descendants: withChildren ? report.descendants : 0,
                    usd: costTotal(view.figure.cost),
                    billedUsd: costTotal(view.figure.cost) - view.figure.byBilling.subscription.usd,
                    listPriceUsd: view.figure.byBilling.subscription.usd,
                    cost: view.figure.cost,
                    headline: view.headline,
                    tokens: view.figure.tokens,
                    totalTokens: figureTokenCount(view.figure),
                    unpricedTokens: view.figure.unpricedTokens,
                    wallMs: view.figure.wallMs,
                    lines: { added: view.figure.linesAdded, removed: view.figure.linesRemoved },
                    turns: view.figure.turns,
                    billing: report.billing,
                    pricesUpdatedAt: pricesUpdatedAt(report.prices.updatedAt),
                    children: withChildren
                      ? report.tree.map((r) => ({ threadId: r.threadId, title: r.title, depth: r.depth, usd: r.ownUsd, treeUsd: r.treeUsd, tokens: r.ownTokens }))
                      : [],
                  },
                  null,
                  2,
                ),
              };
            }
            return { exitCode: 0, stdout: model.summaryText(threadId, withChildren) };
          },
        }),
        top: cliCommand({
          summary: "List the most expensive thread trees (dollars include the list-price equivalent of subscription use)",
          options: {
            project: { type: "string", description: "Only thread trees in this project id" },
            since: {
              type: "duration",
              defaultUnit: "d",
              default: 7 * DAY_MS,
              description: "Thread trees active within this window, e.g. 7d or 30d",
            },
            limit: { type: "integer", min: 1, max: 200, default: 20, description: "How many thread trees (1–200)" },
            json: { type: "boolean", description: "Emit machine-readable JSON" },
          },
          async run(input) {
            await readSettings();
            const all = model.top(input.options.project ?? null, Date.now() - input.options.since);
            // The limit applies to each list, so a full dollar ranking does not hide the Not priced one.
            const trees = { priced: all.priced.slice(0, input.options.limit), notPriced: all.notPriced.slice(0, input.options.limit) };
            if (input.options.json === true) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ pricesUpdatedAt: pricesUpdatedAt(model.pricesInfo().updatedAt), trees: trees.priced, notPriced: trees.notPriced }, null, 2),
              };
            }
            const projectNames = new Map<string, string>();
            if (input.options.project === undefined && trees.priced.length + trees.notPriced.length > 0) {
              try {
                const listed = (await bb.sdk.projects.list()) as unknown as { id: string; name: string }[];
                for (const p of listed) projectNames.set(p.id, p.name);
              } catch {
                // Without names the line just leaves the project out.
              }
            }
            return {
              exitCode: 0,
              stdout: topText(trees, {
                currency: settings.currency,
                projectName: (id) => (id === null ? null : (projectNames.get(id) ?? null)),
                now: Date.now(),
              }),
            };
          },
        }),
      },
    }),
  );

  // ---- agent tool ----
  bb.agents.registerTool({
    name: "thread_usage",
    description: "Returns the tokens and dollars spent by this thread and every thread it spawned, with the billing mode. Dollars are an estimate from models.dev prices; tokens no price covers are counted and not priced.",
    presentation: { label: { pending: "Checking thread usage", completed: "Checked thread usage" } },
    // The SDK types a validated tool's parameters as full zod, but takes any
    // schema with safeParse and validates the call with it, as for full zod.
    parameters: z.strictObject({}) as unknown as Record<string, unknown>,
    async execute(_args, { threadId }) {
      await readSettings();
      await engine.catchUp(threadId);
      const report = model.report(threadId);
      const f = report.treeTotal.figure;
      return JSON.stringify({
        threadId,
        scope: "tree",
        descendants: report.descendants,
        headline: [report.treeTotal.headline.primary, report.treeTotal.headline.detail, report.treeTotal.headline.secondary]
          .filter((part) => part !== null)
          .join(" · "),
        usd: costTotal(f.cost),
        billedUsd: costTotal(f.cost) - f.byBilling.subscription.usd,
        listPriceUsd: f.byBilling.subscription.usd,
        costBySource: f.cost,
        tokens: figureTokenCount(f),
        unpricedTokens: f.unpricedTokens,
        // The tree's billing: "mixed" when its threads are billed differently.
        billing: report.treeTotal.headline.billing,
        thisThreadUsd: costTotal(report.thread.figure.cost),
        pricesUpdatedAt: pricesUpdatedAt(report.prices.updatedAt),
      });
    },
  });
}
