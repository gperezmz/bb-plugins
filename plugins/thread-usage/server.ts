// Thread Usage backend entry. Wires bb's events, settings, storage and host
// entry to the pure modules under src/core and the engine under src/server.
import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { attributionEnv } from "./src/core/headers";
import { testConnection } from "./src/core/litellm";
import { PriceBook } from "./src/core/pricing";
import { turnsCsv } from "./src/core/export";
import { familyContext, familyTags, familyThreads, formatTokens, formatUsd, usualBilling } from "./src/core/format";
import { costTotal, figureTokenCount } from "./src/core/summary";
import { hostContract } from "./src/host/contract";
import { Engine, PANEL_LOG_TIMEOUT_MS, type ThreadDto } from "./src/server/engine";
import { UsageModel } from "./src/server/model";
import { rpcContract } from "./src/server/rpc";
import { parseSettings, SETTINGS, type UsageSettings } from "./src/server/settings";
import {
  flipRefreshPricesDefault,
  LITELLM_META,
  MODELS_DEV_META,
  refreshError,
  refreshPublicPrices,
  type FetchedPrices,
} from "./src/server/public-prices";
import { PINNED_SNAPSHOT } from "./src/server/snapshot";
import { MIGRATIONS, Store, type Db } from "./src/server/store";
import type { GatewayBanner, SettingsStatus } from "./src/core/report-types";
import type { LedgerEvent } from "./src/core/ledger";

export { rpcContract };
export type { RpcContract } from "./src/server/rpc";

const TAGGED_PROVIDERS = ["claude-code", "codex", "pi"];
const RETENTION_MS = 365 * 86_400_000;
/** Bump when a ledger rule changes; stored ledgers are then rebuilt from bb's events. */
const LEDGER_VERSION = 4;
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
  let listPriceBook: PriceBook | null = null;
  // The fetched public lists, read from the store once per refresh; none while the setting is off.
  let fetched: { litellm: FetchedPrices | null; modelsDev: FetchedPrices | null } | null = null;
  const publicPrices = () => {
    if (!settings.refreshPrices) return { litellm: null, modelsDev: null };
    fetched ??= { litellm: store.getMeta<FetchedPrices>(LITELLM_META), modelsDev: store.getMeta<FetchedPrices>(MODELS_DEV_META) };
    return fetched;
  };
  // Lookup order after overrides and the gateway's map: LiteLLM's list (fetched, else bundled), then models.dev.
  const listInput = () => {
    const { litellm, modelsDev } = publicPrices();
    return {
      snapshot: litellm?.models ?? PINNED_SNAPSHOT.models,
      snapshotOrigin: litellm !== null ? ("litellm" as const) : ("snapshot" as const),
      modelsDev: modelsDev?.models,
      overrides: settings.priceOverrides,
    };
  };
  const listPrices = (): PriceBook => {
    listPriceBook ??= new PriceBook(listInput());
    return listPriceBook;
  };
  const prices = (): PriceBook => {
    priceBook ??= new PriceBook({
      ...listInput(),
      gateway: settings.adapter === "litellm" ? engine.gatewayPriceMap() : null,
    });
    return priceBook;
  };
  const pricesChanged = () => {
    fetched = null;
    priceBook = null;
    listPriceBook = null;
    model.invalidateAll();
    bb.realtime.publish("usage-changed", { threadIds: [] });
  };
  const refreshPrices = async () => {
    if (!settings.refreshPrices) return;
    const failing = refreshError(store);
    // A change in what failed also changes the reports' "refresh failing" note.
    if ((await refreshPublicPrices({ store, fetch, now: Date.now, log: bb.log })) || refreshError(store) !== failing) pricesChanged();
  };

  const model: UsageModel = new UsageModel({
    store,
    settings: () => settings,
    prices,
    listPrices,
    pricesMeta: () => ({
      litellmAt: publicPrices().litellm?.fetchedAtMs ?? null,
      modelsDevAt: publicPrices().modelsDev?.fetchedAtMs ?? null,
      bundledDate: PINNED_SNAPSHOT.commitDate ?? PINNED_SNAPSHOT.fetchedAt,
      refreshOn: settings.refreshPrices,
      lastError: settings.refreshPrices ? refreshError(store) : null,
    }),
    now: () => Date.now(),
    gatewayBanner: () => store.getMeta<GatewayBanner | null>("gatewayBanner"),
    gatewayPricesUsed: () => {
      const map = engine.gatewayPriceMap();
      return map !== null && Object.keys(map).length > 0;
    },
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
    fetch: (input, init) => fetch(input, init),
    publish: (channel, payload) => bb.realtime.publish(channel, payload),
    log: bb.log,
  });
  engine.loadGatewayPrices();

  settingsHandle.onChange(async () => {
    const before = settings;
    await readSettings();
    pricesChanged();
    if (settings.refreshPrices && !before.refreshPrices) void refreshPrices();
    if (settings.warnAbove !== before.warnAbove) engine.checkAllBudgets();
    if (settings.adapter === "litellm" && (before.readKey !== settings.readKey || before.gatewayUrl !== settings.gatewayUrl || before.adapter !== settings.adapter)) {
      void engine.sweep();
    }
  });

  // ---- attribution header on every provider command ----
  let providerIds = [...TAGGED_PROVIDERS];
  try {
    const listed = (await bb.sdk.providers.list()) as unknown as { id: string }[] | { providers?: { id: string }[] };
    const ids = (Array.isArray(listed) ? listed : (listed.providers ?? [])).map((p) => p.id);
    providerIds = [...new Set([...providerIds, ...ids])];
  } catch {
    // Isolated harnesses may not bind the SDK at load; the fixed list covers the tagged harnesses.
  }
  for (const providerId of providerIds) {
    bb.providers.experimental_contributeEnv(providerId, (context) =>
      settings.adapter === "litellm"
        ? attributionEnv(providerId, context.threadId, settings.extraHeaders)
        : [],
    );
  }

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
    if (settings.adapter === "litellm") engine.scheduleSweep(20_000);
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
  bb.background.service("gateway-sweep", {
    async start(signal) {
      while (!signal.aborted) {
        if (settings.adapter === "litellm" && engine.anyActive()) await engine.sweep();
        await sleep(60_000, signal);
      }
    },
  });
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
        bb.log.info(`discovered ${listed.size} threads`);
        await engine.resumeInterrupted(wasRunning.filter((id) => listed.has(id)));
      } catch (error) {
        bb.log.warn(`thread discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      engine.checkAllBudgets();
      if (settings.adapter === "litellm") void engine.sweep();
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
    const { litellm, modelsDev } = publicPrices();
    const counts = store.queueCounts();
    return {
      adapter: settings.adapter,
      snapshot: {
        commit: litellm === null ? PINNED_SNAPSHOT.commit : "main",
        date: litellm?.fetchedAt ?? PINNED_SNAPSHOT.commitDate,
        models: Object.keys(litellm?.models ?? PINNED_SNAPSHOT.models).length,
        online: litellm !== null,
        onlineFetchedAt: litellm?.fetchedAtMs ?? null,
        modelsDevFetchedAt: modelsDev?.fetchedAtMs ?? null,
        lastError: settings.refreshPrices ? refreshError(store) : null,
      },
      backfill: {
        ...counts,
        paused: engine.paused(),
        failures: store.failedJobs(5).map((j) => ({ threadId: j.threadId, kind: j.kind, error: j.lastError })),
      },
      gateway: {
        lastSweepAt: store.getMeta<number>("lastSweepAt"),
        lastError: store.getMeta<GatewayBanner | null>("gatewayBanner"),
        rows: store.anyGatewayRows(),
      },
      logsMissing: store
        .threadsWithMissingLogs()
        .map((t) => ({ threadId: t.threadId, host: t.logsMissingHost ?? "", since: t.logsMissingSince ?? 0 })),
      threadsTracked: store.edgeCount(),
    };
  };

  const familyIdsOf = (threadId: string): string[] => {
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
      await engine.refresh(familyIdsOf(threadId));
      return { ok: true };
    },
    async top({ projectId, sinceDays }) {
      await readSettings();
      const families = model.top(projectId, Date.now() - sinceDays * DAY_MS);
      let projects: { id: string; name: string }[] = [];
      try {
        const listed = (await bb.sdk.projects.list()) as unknown as { id: string; name: string }[];
        projects = listed.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        projects = [];
      }
      return { families, projects, prices: model.pricesInfo() };
    },
    async status() {
      await readSettings();
      return status();
    },
    async testConnection() {
      await readSettings();
      if (settings.adapter !== "litellm") return { checks: [], adapter: settings.adapter };
      if (settings.gatewayUrl === "") {
        return {
          adapter: settings.adapter,
          checks: [
            { id: "reachable" as const, label: "Gateway URL answers", status: "fail" as const, detail: "Set the Gateway URL first" },
          ],
        };
      }
      const checks = await testConnection(
        { baseUrl: settings.gatewayUrl, key: settings.readKey ?? "", fetch },
        Date.now(),
        store.allThreadIds().length > 0,
      );
      return { checks, adapter: settings.adapter };
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
            untrackedTokens: report.thread.figure.untrackedTokens,
            billing: report.billing,
            state: report.state,
          },
          // Prompt lines stay in the panel; exports carry no prompt text.
          turns: store.getTurns(edge.threadId).map(({ prompt: _prompt, ...turn }) => turn),
          gatewayRows: store.getGatewayRows(edge.threadId),
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
        "Cost and tokens per thread, rolled up over child threads. Cost comes from the gateway when one is configured, else from the harness, else from list prices.",
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
              const view = withChildren ? report.family : report.thread;
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  {
                    threadId,
                    title: report.title,
                    scope: withChildren ? "family" : "thread",
                    descendants: withChildren ? report.descendants : 0,
                    usd: costTotal(view.figure.cost),
                    billedUsd: costTotal(view.figure.cost) - view.figure.byBilling.subscription.usd,
                    listPriceUsd: view.figure.byBilling.subscription.usd,
                    cost: view.figure.cost,
                    headline: view.headline,
                    tokens: view.figure.tokens,
                    totalTokens: figureTokenCount(view.figure),
                    untrackedTokens: view.figure.untrackedTokens,
                    unpricedTokens: view.figure.unpricedTokens,
                    apiMs: view.figure.apiMs,
                    wallMs: view.figure.wallMs,
                    lines: { added: view.figure.linesAdded, removed: view.figure.linesRemoved },
                    turns: view.figure.turns,
                    billing: report.billing,
                    state: report.state,
                    pricesUpdatedAt: pricesUpdatedAt(report.prices.updatedAt),
                    children: withChildren
                      ? report.tree.map((r) => ({ threadId: r.threadId, title: r.title, depth: r.depth, usd: r.ownUsd, familyUsd: r.familyUsd, tokens: r.ownTokens }))
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
          summary: "List the most expensive thread families (dollars include the list-price equivalent of subscription use)",
          options: {
            project: { type: "string", description: "Only families in this project id" },
            since: {
              type: "duration",
              defaultUnit: "d",
              default: 7 * DAY_MS,
              description: "Families active within this window, e.g. 7d or 30d (default 7d)",
            },
            limit: { type: "integer", min: 1, max: 200, default: 20, description: "How many families (1–200, default 20)" },
            json: { type: "boolean", description: "Emit machine-readable JSON" },
          },
          async run(input) {
            await readSettings();
            const families = model
              .top(input.options.project ?? null, Date.now() - input.options.since)
              .slice(0, input.options.limit);
            if (input.options.json === true) {
              return { exitCode: 0, stdout: JSON.stringify({ pricesUpdatedAt: pricesUpdatedAt(model.pricesInfo().updatedAt), families }, null, 2) };
            }
            if (families.length === 0) return { exitCode: 0, stdout: "No thread families with usage in that window." };
            const projectNames = new Map<string, string>();
            if (input.options.project === undefined) {
              try {
                const listed = (await bb.sdk.projects.list()) as unknown as { id: string; name: string }[];
                for (const p of listed) projectNames.set(p.id, p.name);
              } catch {
                // Without names the line just leaves the project out.
              }
            }
            const usual = usualBilling(families);
            const now = Date.now();
            const lines = families.map((f, i) => {
              // The first line already carries the amount, tokens and thread count.
              const context = familyContext(f, {
                projectName: f.projectId === null ? null : (projectNames.get(f.projectId) ?? null),
                countThreads: false,
                now,
              });
              const second = [...context, ...familyTags(f, usual)].join(" · ");
              const threads = familyThreads(f);
              return `${String(i + 1).padStart(2)}. ${formatUsd(f.usd, settings.currency).padEnd(9)} ${formatTokens(f.tokens).padStart(6)} tokens  ${f.title.slice(0, 60)}  (${f.threadId}${threads === null ? "" : `, ${threads}`})${second === "" ? "" : `\n      ${second}`}`;
            });
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
      },
    }),
  );

  // ---- agent tool ----
  bb.agents.registerTool({
    name: "thread_usage",
    description: "Cost and tokens of this thread plus every thread it spawned, with cost source and billing mode.",
    presentation: { label: { pending: "Checking thread usage", completed: "Checked thread usage" } },
    parameters: z.object({}).strict(),
    async execute(_args, { threadId }) {
      await readSettings();
      await engine.catchUp(threadId);
      const report = model.report(threadId);
      const f = report.family.figure;
      return JSON.stringify({
        threadId,
        scope: "family",
        descendants: report.descendants,
        headline: [report.family.headline.primary, report.family.headline.detail, report.family.headline.secondary]
          .filter((part) => part !== null)
          .join(" · "),
        usd: costTotal(f.cost),
        billedUsd: costTotal(f.cost) - f.byBilling.subscription.usd,
        listPriceUsd: f.byBilling.subscription.usd,
        costBySource: f.cost,
        tokens: figureTokenCount(f),
        unpricedTokens: f.unpricedTokens,
        // The family's billing: "mixed" when its threads are billed differently.
        billing: report.family.headline.billing,
        thisThreadUsd: costTotal(report.thread.figure.cost),
        pricesUpdatedAt: pricesUpdatedAt(report.prices.updatedAt),
      });
    },
  });
}
