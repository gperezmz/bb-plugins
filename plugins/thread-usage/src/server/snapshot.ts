/**
 * The pinned LiteLLM price snapshot shipped with the plugin (MIT; see
 * prices/LICENSE-litellm.txt). Regenerate with scripts/update-prices.mjs.
 */
import snapshot from "../../prices/litellm-prices.json" with { type: "json" };
import type { LiteLlmPriceEntry } from "../core/pricing";

export interface PriceSnapshot {
  source: string;
  commit: string;
  commitDate: string | null;
  fetchedAt: string;
  models: Record<string, LiteLlmPriceEntry>;
}

export const PINNED_SNAPSHOT = snapshot as PriceSnapshot;

export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const KEEP = /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)(_above_1hr|_above_200k_tokens|_above_272k_tokens)?$/;

/** Trims LiteLLM's full price map to chat models and the keys pricing reads. */
export function trimPriceMap(raw: unknown): Record<string, LiteLlmPriceEntry> {
  const out: Record<string, LiteLlmPriceEntry> = {};
  if (raw === null || typeof raw !== "object") return out;
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (name === "sample_spec" || entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.mode !== undefined && e.mode !== "chat" && e.mode !== "responses" && e.mode !== "completion") continue;
    if (typeof e.input_cost_per_token !== "number" || typeof e.output_cost_per_token !== "number") continue;
    const kept: LiteLlmPriceEntry = {};
    for (const [k, v] of Object.entries(e)) {
      if (KEEP.test(k) && typeof v === "number" && Number.isFinite(v)) kept[k] = v;
    }
    out[name] = kept;
  }
  return out;
}
