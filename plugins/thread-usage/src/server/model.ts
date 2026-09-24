/**
 * Reads stored ledger, gateway rows and log entries and computes what every
 * surface shows. Family totals are computed when read, never stored,
 * because a parent can change.
 */
import {
  attributionState,
  billingMode,
  billingSettingKey,
  describeState,
  isCursorProvider,
  routingFrom,
  SETUP_SNIPPETS,
  type AttributionState,
  type BillingMode,
} from "../core/attribution";
import {
  ancestorIds,
  familyTree,
  forksOf,
  indexEdges,
  type EdgeIndex,
  type FamilyNode,
} from "../core/family";
import { formatDuration, formatTokens, formatUsd, headline, pricesStale } from "../core/format";
import type { RateLimitKind } from "../core/ledger";
import type { PriceBook } from "../core/pricing";
import type {
  ChipView,
  FigureView,
  ForkRow,
  GatewayBanner,
  PriceSourceInfo,
  PricesInfo,
  PricesMeta,
  QualityNote,
  ThreadReport,
  TopFamily,
  TreeRow,
} from "../core/report-types";
import {
  costTotal,
  figureTokenCount,
  hasAnyUsage,
  mergeLogEntries,
  sumFigures,
  threadUsage,
  type Figure,
  type ThreadUsage,
} from "../core/summary";
import type { EdgeExtra, Store, ThreadState } from "./store";
import type { UsageSettings } from "./settings";

export interface ModelDeps {
  store: Store;
  settings: () => UsageSettings;
  prices: () => PriceBook;
  /**
   * List prices (overrides and snapshot, without the gateway's map), for
   * figures shown as a list-price equivalent.
   */
  listPrices: () => PriceBook;
  pricesMeta: () => PricesMeta;
  now: () => number;
  gatewayBanner: () => GatewayBanner | null;
  /** True when the gateway's `/model/info` price map is loaded. */
  gatewayPricesUsed: () => boolean;
}

export interface ThreadComputed {
  threadId: string;
  edge: EdgeExtra | null;
  state: AttributionState;
  billing: BillingMode;
  routingHost: string | null;
  usage: ThreadUsage;
  thread: ThreadState | null;
}

export class UsageModel {
  private readonly cache = new Map<string, { version: number; value: ThreadComputed }>();
  private versions = new Map<string, number>();
  private globalVersion = 0;

  private kinds: { at: number; map: Map<string, string> } | null = null;

  constructor(private readonly deps: ModelDeps) {}

  /** Latest rate-limit kind per provider, refreshed at most once a minute. */
  private providerKinds(): Map<string, string> {
    const now = this.deps.now();
    if (this.kinds === null || now - this.kinds.at > 60_000) {
      this.kinds = { at: now, map: this.deps.store.latestRateLimitKinds() };
    }
    return this.kinds.map;
  }

  /** Forget cached figures for these threads (after a write). */
  invalidate(threadIds: Iterable<string>): void {
    for (const id of threadIds) this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
  }

  /** Forget every cached figure (settings or prices changed). */
  invalidateAll(): void {
    this.globalVersion += 1;
  }

  index(): EdgeIndex {
    return indexEdges(this.deps.store.allEdges());
  }

  computeThread(threadId: string, index: EdgeIndex): ThreadComputed {
    const version = this.globalVersion * 1_000_000 + (this.versions.get(threadId) ?? 0);
    const cached = this.cache.get(threadId);
    if (cached !== undefined && cached.version === version) return cached.value;
    const value = this.computeThreadUncached(threadId, index);
    this.cache.set(threadId, { version, value });
    return value;
  }

  private computeThreadUncached(threadId: string, index: EdgeIndex): ThreadComputed {
    const { store } = this.deps;
    const settings = this.deps.settings();
    const now = this.deps.now();
    const edge = (store.getEdge(threadId) ?? null) as EdgeExtra | null;
    const thread = store.getThread(threadId);
    const turns = store.getTurns(threadId);
    // Stored rows stay on disk, but with the adapter off cost is estimated (`no-adapter`).
    const rows = settings.adapter === "litellm" ? store.getGatewayRows(threadId) : [];
    const entries = settings.readLogs ? store.getLogEntries(threadId) : [];
    const providerId = edge?.providerId ?? null;
    const routing = routingFrom(thread?.cursor.routing ?? [], settings.gatewayUrl || null);
    const hasOutput = turns.some((t) => t.tokens.output > 0);
    const state = attributionState({
      adapter: settings.adapter,
      providerId,
      routing,
      hasRows: rows.length > 0,
      hasTurns: turns.some((t) => t.kind === "turn"),
      hasOutputTokens: hasOutput,
      // A thread that is not running and never reported going idle counts as idle since it was last seen.
      idleSince:
        edge?.status === "active" ? null : (edge?.idleSince ?? thread?.lastActivityAt ?? thread?.firstSeenAt ?? 0),
      now,
    });
    const billing = billingMode({
      state,
      setting: settings.billing[billingSettingKey(providerId)],
      // A thread that never reported a rate-limit kind takes its provider's latest one.
      rateLimitKind:
        thread?.cursor.rateLimitKind ??
        ((this.providerKinds().get(providerId ?? "") as RateLimitKind | undefined) ?? null),
    });
    const isFork = edge?.sourceThreadId != null;
    const logs = mergeLogEntries(entries, {
      firstSeenAt: thread?.firstSeenAt ?? null,
      historyBackfilled: thread?.historyBackfilled ?? false,
      partialGaps: (thread?.gaps ?? []).filter((g) => g.resolution === "partial"),
      forkCreatedAt: isFork ? (edge?.createdAt ?? null) : null,
      harnessCost: providerId === "pi",
    });
    const usage = threadUsage({
      turns,
      rows,
      logs,
      // A subscription's dollars are a list-price equivalent, whatever the gateway charges.
      prices: billing === "subscription" ? this.deps.listPrices() : this.deps.prices(),
      billing,
      now,
      historyBefore: thread?.firstSeenAt ?? null,
    });
    void index;
    return {
      threadId,
      edge,
      state,
      billing,
      routingHost: routing.kind === "other-host" ? routing.host : null,
      usage,
      thread,
    };
  }

  familyFigure(
    rootId: string,
    index: EdgeIndex,
  ): { figure: Figure; tree: FamilyNode; byNode: Map<string, Figure> } {
    const tree = familyTree(index, rootId);
    const byNode = new Map<string, Figure>();
    const post = (node: FamilyNode): Figure => {
      const own = this.computeThread(node.edge.threadId, index).usage.figure;
      const figure = sumFigures([own, ...node.children.map(post)]);
      byNode.set(node.edge.threadId, figure);
      return figure;
    };
    const figure = post(tree);
    return { figure, tree, byNode };
  }

  view(figure: Figure): FigureView {
    return { figure, headline: headline(figure, this.deps.settings().currency) };
  }

  /** How fresh the prices behind estimates are, for the panels, the CLI and the agent tool. */
  pricesInfo(): PricesInfo {
    const meta = this.deps.pricesMeta();
    const updatedAt = meta.litellmAt;
    return {
      updatedAt,
      bundledDate: meta.bundledDate,
      refreshOn: meta.refreshOn,
      stale: pricesStale(updatedAt, this.deps.now()),
      lastError: meta.lastError,
    };
  }

  /** Per model of a figure's By-model table: which list priced it, and when that list was fetched. */
  private pricesReport(figure: Figure): ThreadReport["prices"] {
    const meta = this.deps.pricesMeta();
    // A figure of subscription use only is priced from the public lists, not the gateway's map.
    const subscriptionOnly = (["gateway", "api-key", "unknown"] as const).every(
      (mode) => figure.byBilling[mode].tokens === 0 && figure.byBilling[mode].usd === 0,
    );
    const book = subscriptionOnly ? this.deps.listPrices() : this.deps.prices();
    const models: Record<string, PriceSourceInfo> = {};
    for (const line of figure.byModel) {
      const found = book.lookup(line.model);
      if (found === null) continue;
      const fetchedAt =
        found.origin === "litellm" ? meta.litellmAt : found.origin === "models.dev" ? meta.modelsDevAt : null;
      models[line.model] = { source: found.origin, as: found.model, fetchedAt };
    }
    return { ...this.pricesInfo(), models };
  }

  report(threadId: string): ThreadReport {
    const settings = this.deps.settings();
    const index = this.index();
    const self = this.computeThread(threadId, index);
    const { figure: familyFig, tree, byNode } = this.familyFigure(threadId, index);
    const familyUsd = costTotal(familyFig.cost);
    const familyTokens = figureTokenCount(familyFig);
    // Share follows what the headline leads with: tokens for a subscription family.
    const familyHeadline = headline(familyFig, settings.currency);
    const shareByTokens = familyHeadline.primaryKind === "tokens" || familyUsd === 0;
    // A mixed family's headline shows billed dollars only, so its share does too.
    const billedOf = (f: Figure) => costTotal(f.cost) - f.byBilling.subscription.usd;
    const familyBilled = billedOf(familyFig);
    const rows: TreeRow[] = [];
    let descendants = 0;
    let hiddenDescendants = 0;
    const walk = (node: FamilyNode) => {
      const computed = this.computeThread(node.edge.threadId, index);
      const own = computed.usage.figure;
      const fam = byNode.get(node.edge.threadId) ?? own;
      if (node !== tree) {
        descendants += 1;
        if (node.edge.hidden) hiddenDescendants += 1;
        const famUsd = costTotal(fam.cost);
        const famTokens = figureTokenCount(fam);
        const ownHeadline = headline(own, settings.currency);
        const famHeadline = headline(fam, settings.currency);
        rows.push({
          threadId: node.edge.threadId,
          parentThreadId: node.edge.parentThreadId,
          title: node.edge.title ?? node.edge.threadId,
          titleFromPrompt: (node.edge as EdgeExtra).titleFromPrompt === true,
          providerId: node.edge.providerId,
          depth: node.depth,
          status: computed.edge?.status ?? null,
          hidden: node.edge.hidden,
          archived: node.edge.archivedAt !== null,
          deleted: node.edge.deletedAt !== null,
          state: computed.state,
          billing: computed.billing,
          ownChip: ownHeadline.chip,
          ownUsd: costTotal(own.cost),
          ownTokens: figureTokenCount(own),
          familyChip: famHeadline.chip,
          familyUsd: famUsd,
          familyTokens: famTokens,
          share: shareByTokens
            ? familyTokens > 0
              ? famTokens / familyTokens
              : 0
            : familyHeadline.billing === "mixed"
              ? familyBilled > 0
                ? billedOf(fam) / familyBilled
                : 0
              : famUsd / familyUsd,
        });
      }
      node.children.forEach(walk);
    };
    walk(tree);
    const forks: ForkRow[] = forksOf(index, threadId).map((edge) => {
      const f = this.computeThread(edge.threadId, index).usage.figure;
      return {
        threadId: edge.threadId,
        title: edge.title ?? edge.threadId,
        titleFromPrompt: (edge as EdgeExtra).titleFromPrompt === true,
        providerId: edge.providerId,
        chip: headline(f, settings.currency).chip,
        usd: costTotal(f.cost),
        tokens: figureTokenCount(f),
        sideChat: (edge.title ?? "").toLowerCase().includes("side chat"),
      };
    });
    const crossing =
      settings.warnAbove === null ? null : this.deps.store.crossingFor(threadId, settings.warnAbove);
    return {
      threadId,
      title: self.edge?.title ?? threadId,
      titleFromPrompt: self.edge?.titleFromPrompt === true,
      providerId: self.edge?.providerId ?? null,
      projectId: self.edge?.projectId ?? null,
      generatedAt: this.deps.now(),
      currency: settings.currency,
      prices: this.pricesReport(familyFig),
      thread: this.view(self.usage.figure),
      family: this.view(familyFig),
      descendants,
      hiddenDescendants,
      state: self.state,
      billing: self.billing,
      stateMessage: self.state === "untagged" && self.billing === "subscription" ? null : describeState(self.state, {
        host: self.routingHost,
        providerId: self.edge?.providerId ?? null,
      }),
      firstSeenAt: self.thread?.firstSeenAt ?? null,
      turns: self.usage.turns,
      tree: rows,
      forks,
      quality: this.quality(self, index, familyFig),
      gatewayBanner: settings.adapter === "litellm" ? this.deps.gatewayBanner() : null,
      budget:
        crossing === null || settings.warnAbove === null
          ? null
          : { amount: settings.warnAbove, crossedAt: crossing.crossedAt },
    };
  }

  private quality(self: ThreadComputed, index: EdgeIndex, family: Figure): QualityNote[] {
    const settings = this.deps.settings();
    const notes: QualityNote[] = [];
    const providerId = self.edge?.providerId ?? null;
    const fig = self.usage.figure;
    const opening = self.usage.turns.find((t) => t.kind === "opening");
    if (opening !== undefined && self.thread?.firstSeenAt != null) {
      notes.push({
        id: "partial-history",
        tone: "warn",
        text: `Usage before ${new Date(self.thread.firstSeenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} is incomplete${
          settings.readLogs && !isCursorProvider(providerId)
            ? "; a harness-log backfill is queued"
            : ""
        }`,
      });
    }
    if (fig.partial && opening === undefined) {
      notes.push({
        id: "partial-gap",
        tone: "warn",
        text: "Some turns lost their usage events during a harness restart; they are partial until a log backfill fills them",
      });
    }
    if (self.thread?.logsMissingSince != null && settings.readLogs) {
      notes.push({
        id: "logs-missing",
        tone: "warn",
        text: `Logs on ${self.thread.logsMissingHost ?? "the thread's machine"} unavailable since ${new Date(self.thread.logsMissingSince).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}; subagent and history figures fill in when it is back`,
      });
    }
    if (fig.unpricedModels.length > 0 || family.unpricedModels.length > 0) {
      const models = [...new Set([...fig.unpricedModels, ...family.unpricedModels])];
      notes.push({
        id: "unpriced",
        tone: "warn",
        text: `No price for ${models.join(", ")}: tokens are counted but not priced. Add a price override in settings.`,
      });
    }
    // A subscription thread never reaches a gateway, so "not tagged" is noise there.
    if (self.state === "untagged" && providerId !== null && self.billing !== "subscription") {
      const snippet =
        providerId === "codex" ? SETUP_SNIPPETS.codex : providerId === "pi" ? SETUP_SNIPPETS.pi : null;
      notes.push({
        id: "untagged",
        // Claude Code history from before tagging is expected, not a fault.
        tone: providerId === "claude-code" ? "info" : "warn",
        text:
          describeState("untagged", { providerId }) ??
          "Requests are not tagged",
        ...(snippet === null
          ? {}
          : { snippet: { label: snippet.file, code: snippet.snippet } }),
      });
    }
    if (self.state === "account-pool" || self.state === "not-routed") {
      notes.push({
        id: "routing",
        tone: "info",
        text: describeState(self.state, { host: self.routingHost }) ?? "",
      });
    }
    if (self.state === "pending") {
      notes.push({ id: "pending", tone: "info", text: "Waiting for gateway spend… it lands 2–15 s after a request" });
    }
    if (self.state === "unsupported") {
      notes.push({ id: "cursor", tone: "warn", text: "No token or cost data for Cursor: its requests never reach bb or a gateway" });
    }
    if (self.billing === "unknown" && figureTokenCount(fig) > 0) {
      notes.push({ id: "billing-unknown", tone: "info", text: "Billing unknown: set it in settings. Cost is shown as a list-price estimate." });
    }
    if (self.billing === "subscription") {
      notes.push({ id: "subscription", tone: "info", text: "Subscription plan: tokens are what counts; dollars are a list-price equivalent" });
    }
    if (self.usage.reconciliation !== null) {
      const tokens = formatTokens(self.usage.reconciliation.untrackedTokens);
      notes.push({
        id: "untracked",
        tone: "info",
        text:
          settings.readLogs
            ? `${tokens} gateway tokens in requests outside bb's and the logs' view`
            : `${tokens} gateway tokens made by subagents or tools outside bb's view (turn on Read harness logs to see them)`,
      });
    }
    if (providerId === "claude-code" && !settings.readLogs && self.state !== "tagged") {
      notes.push({ id: "subagents-off", tone: "info", text: "Claude Code subagent tokens are not counted: Read harness logs is off" });
    }
    if (fig.approximate) {
      notes.push({ id: "approximate", tone: "info", text: "Some prices are approximate: a long-context tier or cache rate needed per-request sizes bb does not record" });
    }
    if (settings.priceOverridesError !== null) {
      notes.push({ id: "overrides", tone: "warn", text: `Price overrides are ignored: ${settings.priceOverridesError}` });
    }
    if (self.edge?.status === "active") {
      notes.push({
        id: "running",
        tone: "info",
        text: "A turn is running: harnesses report its tokens when it ends, so it is not counted yet",
      });
    }
    if (
      settings.adapter === "litellm" &&
      self.billing !== "subscription" &&
      fig.cost.estimate > 0 &&
      this.deps.gatewayPricesUsed()
    ) {
      notes.push({
        id: "gateway-prices",
        tone: "info",
        text: "Estimates use the gateway's own price map where it has the model, so they can differ from list prices",
      });
    }
    notes.push({ id: "lines", tone: "info", text: "Lines changed through shell commands are not counted" });
    void index;
    return notes;
  }

  chip(threadId: string): ChipView {
    const settings = this.deps.settings();
    const index = this.index();
    const { figure, tree } = this.familyFigure(threadId, index);
    let descendants = 0;
    let hiddenDescendants = 0;
    const walk = (node: FamilyNode) => {
      if (node !== tree) {
        descendants += 1;
        if (node.edge.hidden) hiddenDescendants += 1;
      }
      node.children.forEach(walk);
    };
    walk(tree);
    const h = headline(figure, settings.currency);
    // Attention: this family, or any family it belongs to, crossed the budget.
    let attention = false;
    let toast: ChipView["toast"] = null;
    if (settings.warnAbove !== null) {
      for (const id of [threadId, ...ancestorIds(index, threadId)]) {
        const crossing = this.deps.store.crossingFor(id, settings.warnAbove);
        if (crossing === null) continue;
        attention = true;
        if (crossing.toastedAt === null && toast === null) {
          toast = {
            amount: settings.warnAbove,
            total: formatUsd(crossing.total, settings.currency),
            title: index.byId.get(id)?.title ?? id,
            rootThreadId: id,
          };
        }
      }
    }
    return {
      visible: figure.turns > 0 || hasAnyUsage(figure),
      chip: h.chip,
      headline: h,
      tokens: figure.tokens,
      untrackedTokens: figure.untrackedTokens,
      descendants,
      hiddenDescendants,
      turns: figure.turns,
      attention,
      toast,
    };
  }

  /** Families (roots with no parent) ordered by billed dollars, then tokens. */
  top(projectId: string | null, sinceMs: number): TopFamily[] {
    const settings = this.deps.settings();
    const index = this.index();
    const out: TopFamily[] = [];
    for (const edge of index.byId.values()) {
      if (edge.parentThreadId !== null && index.byId.has(edge.parentThreadId) && edge.sourceThreadId === null) {
        continue;
      }
      if (projectId !== null && edge.projectId !== projectId) continue;
      const { figure, tree } = this.familyFigure(edge.threadId, index);
      if (!hasAnyUsage(figure)) continue;
      let last: number | null = null;
      let descendants = 0;
      const walk = (node: FamilyNode) => {
        if (node !== tree) descendants += 1;
        const t = this.deps.store.getThread(node.edge.threadId);
        const at = t?.lastActivityAt ?? null;
        if (at !== null && (last === null || at > last)) last = at;
        node.children.forEach(walk);
      };
      walk(tree);
      if (last === null || (last as number) < sinceMs) continue;
      const h = headline(figure, settings.currency);
      out.push({
        threadId: edge.threadId,
        title: edge.title ?? edge.threadId,
        providerId: edge.providerId,
        projectId: edge.projectId,
        headline: h,
        usd: costTotal(figure.cost),
        billedUsd: costTotal(figure.cost) - figure.byBilling.subscription.usd,
        listPriceUsd: figure.byBilling.subscription.usd,
        tokens: figureTokenCount(figure),
        descendants,
        lastActivityAt: last,
        billing: h.billing,
      });
    }
    return out.sort((a, b) => b.usd - a.usd || b.tokens - a.tokens || a.threadId.localeCompare(b.threadId));
  }

  /** Family billed totals of the thread and each ancestor, for budget checks. */
  ancestorTotals(threadId: string): Map<string, number> {
    const index = this.index();
    const out = new Map<string, number>();
    for (const id of [threadId, ...ancestorIds(index, threadId)]) {
      const { figure } = this.familyFigure(id, index);
      out.set(id, costTotal(figure.cost) - figure.byBilling.subscription.usd);
    }
    return out;
  }

  /** Short text for CLI and agent tool output. */
  summaryText(threadId: string, withChildren: boolean): string {
    const report = this.report(threadId);
    const view = withChildren ? report.family : report.thread;
    const f = view.figure;
    const lines = [
      `${report.title} (${threadId})${withChildren ? `, with ${report.descendants} descendant thread${report.descendants === 1 ? "" : "s"}` : ""}`,
      `${view.headline.primary}  ${view.headline.detail}`,
      ...(view.headline.secondary === null ? [] : [view.headline.secondary]),
      ...(view.headline.unpricedNote === null ? [] : [view.headline.unpricedNote]),
      `Tokens: ${formatTokens(figureTokenCount(f))} (in ${formatTokens(f.tokens.input)}, out ${formatTokens(f.tokens.output)}, cache read ${formatTokens(f.tokens.cacheRead)}, cache write ${formatTokens(f.tokens.cacheWrite)})`,
      `Turns: ${f.turns}  Wall time: ${formatDuration(f.wallMs)}  API time: ${f.apiMs === null ? "—" : formatDuration(f.apiMs)}  Lines: +${f.linesAdded} −${f.linesRemoved}`,
      `Billing: ${report.billing}  Attribution: ${report.state}`,
    ];
    return lines.join("\n");
  }
}
