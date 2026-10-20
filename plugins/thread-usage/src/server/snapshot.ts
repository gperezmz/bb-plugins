/**
 * The models.dev price list bundled with the plugin (MIT; see
 * prices/LICENSE-models-dev.txt). It is the list in use until a fetch has
 * succeeded, and whenever Refresh prices online is off. Regenerate it with
 * scripts/update-prices.mjs.
 */
import snapshot from "../../prices/models-dev-prices.json" with { type: "json" };
import type { ModelPrice } from "../core/pricing";

export interface PriceSnapshot {
  source: string;
  fetchedAt: string;
  models: Record<string, ModelPrice>;
}

export const PINNED_SNAPSHOT = snapshot as unknown as PriceSnapshot;
