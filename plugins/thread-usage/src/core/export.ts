/**
 * Export (the Usage tab's Copy as Markdown and Download CSV, and the settings
 * page's Export all): Markdown and CSV built from the same report the panel
 * shows, so every turn record appears.
 */
import { formatDuration, formatExactTokens, formatTokens, formatUsd, pricesLabel } from "./format";
import type { ThreadReport } from "./report-types";
import { costTotal } from "./figure-math";
import type { TurnView } from "./summary";

const TURN_COLUMNS = [
  "turn_id",
  "kind",
  "started_at",
  "completed_at",
  "status",
  "model",
  "turn",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "cost_gateway_usd",
  "cost_harness_usd",
  "cost_estimate_usd",
  "cost_source",
  "unpriced_tokens",
  "gateway_requests",
  "api_ms",
  "lines_added",
  "lines_removed",
  "subagent_requests",
  "partial",
] as const;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function iso(ms: number | null): string {
  return ms === null ? "" : new Date(ms).toISOString();
}

export function turnCsvRow(t: TurnView, label: string): string[] {
  return [
    t.turnId,
    t.kind,
    iso(t.startedAt),
    iso(t.completedAt),
    t.status,
    t.model ?? "",
    label,
    String(t.tokens.input),
    String(t.tokens.output),
    String(t.tokens.cacheRead),
    String(t.tokens.cacheWrite),
    t.cost.gateway.toFixed(6),
    t.cost.harness.toFixed(6),
    t.cost.estimate.toFixed(6),
    t.source,
    String(t.unpricedTokens),
    String(t.requests),
    t.apiMs === null ? "" : String(t.apiMs),
    String(t.linesAdded),
    String(t.linesRemoved),
    String(t.subagents.reduce((n, s) => n + s.requests, 0)),
    t.partial ? "true" : "false",
  ];
}

/** One CSV row per turn record of the thread. */
export function turnsCsv(turns: readonly TurnView[], prefix?: { header: string[]; cells: string[] }): string {
  const header = [...(prefix?.header ?? []), ...TURN_COLUMNS];
  const lines = [header.join(",")];
  const labels = turnLabels(turns);
  for (const t of turns) {
    lines.push([...(prefix?.cells ?? []), ...turnCsvRow(t, labels.get(t.turnId) ?? t.turnId)].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const KIND_LABEL: Record<Exclude<TurnView["kind"], "turn">, string> = {
  opening: "Before first seen (partial)",
  history: "History from harness logs",
  outside: "Requests outside turns",
};

/**
 * What each row is, without its prompt: "Turn 3", or what a synthetic row
 * stands for. Exports never carry prompt text, which can hold anything a
 * user pasted.
 */
export function turnLabels(turns: readonly TurnView[]): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  for (const t of turns) {
    if (t.kind === "turn") out.set(t.turnId, t.turnId === "retained" ? "Older than a year" : `Turn ${++n}`);
    else out.set(t.turnId, KIND_LABEL[t.kind]);
  }
  return out;
}

function mdEscape(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** The report as Markdown: headline, stats, models, every turn, children, forks, data quality. */
export function reportMarkdown(r: ThreadReport, scope: "thread" | "family"): string {
  const view = scope === "family" ? r.family : r.thread;
  const f = view.figure;
  const cur = r.currency;
  const out: string[] = [];
  // Titles bb built from the first prompt stay out, as prompts do.
  const titleOf = (t: { title: string; titleFromPrompt: boolean; threadId: string }) =>
    t.titleFromPrompt ? t.threadId : t.title;
  out.push(`# Usage: ${mdEscape(titleOf(r))}`);
  out.push("");
  out.push(
    `**${view.headline.primary}** ${view.headline.detail}${scope === "family" ? ` (with ${r.descendants} descendant threads)` : " (this thread)"}`,
  );
  if (view.headline.secondary !== null) out.push(`\n${view.headline.secondary}`);
  if (view.headline.unpricedNote !== null) out.push(`\n${view.headline.unpricedNote}`);
  out.push("");
  out.push("| API time | Wall time | Lines | Turns |");
  out.push("|---|---|---|---|");
  out.push(
    `| ${f.apiMs === null ? "—" : formatDuration(f.apiMs)} | ${formatDuration(f.wallMs)} | +${f.linesAdded} −${f.linesRemoved} | ${f.turns} |`,
  );
  out.push("");
  out.push("## Tokens");
  out.push("");
  out.push(
    `Input ${formatExactTokens(f.tokens.input)} · output ${formatExactTokens(f.tokens.output)} · cache read ${formatExactTokens(f.tokens.cacheRead)} · cache write ${formatExactTokens(f.tokens.cacheWrite)}${f.untrackedTokens > 0 ? ` · outside bb's view ${formatExactTokens(f.untrackedTokens)}` : ""}`,
  );
  out.push("");
  out.push("## By model");
  out.push("");
  out.push("| Model | Tokens | Cost | Source |");
  out.push("|---|---|---|---|");
  for (const m of f.byModel) {
    const sources = (["gateway", "harness", "estimate"] as const).filter((s) => m.cost[s] > 0);
    out.push(
      `| ${mdEscape(m.model)} | ${formatTokens(m.tokens.input + m.tokens.output + m.tokens.cacheRead + m.tokens.cacheWrite + m.gatewayTokens)} | ${m.unpricedTokens > 0 && costTotal(m.cost) === 0 ? "unpriced" : formatUsd(costTotal(m.cost), cur)} | ${sources.join(", ") || (m.unpricedTokens > 0 ? "unpriced" : "—")} |`,
    );
  }
  out.push("");
  out.push("## Turns (this thread)");
  out.push("");
  out.push("| Turn | Id | Started | Model | Tokens | Cost | Source |");
  out.push("|---|---|---|---|---|---|---|");
  const labels = turnLabels(r.turns);
  r.turns.forEach((t) => {
    out.push(
      `| ${mdEscape(labels.get(t.turnId) ?? "")} | ${mdEscape(t.turnId)} | ${t.startedAt === null ? "" : new Date(t.startedAt).toISOString().slice(0, 16).replace("T", " ")} | ${mdEscape(t.model ?? "")} | ${formatTokens(t.tokens.input + t.tokens.output + t.tokens.cacheRead + t.tokens.cacheWrite)} | ${t.source === "unpriced" ? "unpriced" : formatUsd(costTotal(t.cost), cur)} | ${t.source} |`,
    );
  });
  if (r.tree.length > 0) {
    out.push("");
    out.push("## Child threads");
    out.push("");
    out.push("| Thread | Harness | Own | With children | Share |");
    out.push("|---|---|---|---|---|");
    for (const row of r.tree) {
      const marks = [row.hidden ? "hidden" : null, row.archived ? "archived" : null, row.deleted ? "deleted" : null]
        .filter(Boolean)
        .join(", ");
      out.push(
        `| ${"  ".repeat(Math.max(0, row.depth - 1))}${mdEscape(titleOf(row))}${marks === "" ? "" : ` (${marks})`} | ${row.providerId ?? ""} | ${row.ownChip} | ${row.familyChip} | ${Math.round(row.share * 100)}% |`,
      );
    }
  }
  if (r.forks.length > 0) {
    out.push("");
    out.push("## Forks of this thread (not included above)");
    out.push("");
    for (const fork of r.forks) out.push(`- ${mdEscape(titleOf(fork))}: ${fork.chip}`);
  }
  const notes = r.quality;
  if (notes.length > 0) {
    out.push("");
    out.push("## Data quality");
    out.push("");
    for (const q of notes) out.push(`- ${q.text}${q.snippet ? `: \`${q.snippet.code}\`` : ""}`);
  }
  out.push("");
  out.push(
    `_Generated ${new Date(r.generatedAt).toISOString()} by Thread Usage. ${pricesLabel(r.prices, r.generatedAt)}._`,
  );
  return `${out.join("\n")}\n`;
}
