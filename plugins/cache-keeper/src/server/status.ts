/** What `bb cache-keeper status` prints for one thread, as text and as JSON. */
import { formatSize } from "../core/line";
import { statusText, type ThreadView } from "../core/view";
import type { ResetNotice } from "./reinstall";

const SOURCES: Record<string, string> = { litellm: "LiteLLM", "models.dev": "models.dev", bundled: "bundled" };

/** The price source as `status` names it; where there is none, whether that is because the thread's model is not read yet or because no price list has it. */
export const priceSource = (v: Pick<ThreadView, "priceOrigin" | "model">) => {
  if (v.priceOrigin !== null) return SOURCES[v.priceOrigin] ?? v.priceOrigin;
  return v.model === null ? "none yet: model not read" : "none: the model has no price";
};

const decisionText = (v: ThreadView) => {
  if (v.decision === null) return "none yet";
  const at = new Date(v.decision.at).toISOString();
  return v.decision.reason === null ? `sent ${v.decision.what} at ${at}` : `held back ${v.decision.what} at ${at}: ${v.decision.reason}`;
};

export function describe(v: ThreadView, now: number, priceError: string | null): string {
  const lines = [
    `${v.title} (${v.threadId})`,
    `  compact when idle: ${v.compactOn ? "on" : "off"}`,
    `  line: ${v.windowKnown ? formatSize(v.line) : "none until bb reports the thread's context window"}`,
    `  context: ${v.context === null ? "unknown" : formatSize(v.context)}${v.windowKnown ? ` of ${formatSize(v.window)}` : ""}`,
    `  status: ${v.transcriptUnreadable !== null ? "transcript unreadable" : statusText(v, now)}`,
    `  last decision: ${decisionText(v)}`,
    `  keep-warms: ${v.warmNoPrice ? "held: this model has no price" : v.keptWarm ? "on for its tree" : "off for its tree"}`,
    `  price source: ${priceSource(v)}`,
    `  rests on: ${v.model ?? "unknown model"}, ${v.lifetime === null ? "unknown" : v.lifetime === "5m" ? "5-minute" : "1-hour"} cache, ${v.callsPerMessage.toFixed(1)} calls per message${v.callsMeasured ? "" : " (default)"}, ${formatSize(v.postCompaction)} after compacting${v.postMeasured ? "" : " (default)"}`,
  ];
  if (v.transcriptUnreadable !== null) lines.push(`  transcript unreadable: ${v.transcriptUnreadable}`);
  if (priceError !== null) lines.push(`  last price fetch error: ${priceError}`);
  return lines.join("\n");
}

export function statusJson(v: ThreadView, now: number, priceError: string | null, reset: ResetNotice | null) {
  return {
    ...v,
    statusText: v.transcriptUnreadable !== null ? "transcript unreadable" : statusText(v, now),
    priceSource: priceSource(v),
    lastPriceFetchError: priceError,
    ...(reset === null ? {} : { reset }),
  };
}
