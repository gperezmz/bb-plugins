/**
 * Shapes the backend sends to the frontend, the CLI and the agent tool.
 * Type-only: the frontend imports these without pulling in server code.
 */
import type { AttributionState, BillingMode } from "./attribution";
import type { Headline } from "./format";
import type { PriceOrigin } from "./pricing";
import type { ConnectionCheck, ConnectionCheckId } from "./litellm";
import type { Figure, TurnView } from "./summary";

export interface FigureView {
  figure: Figure;
  headline: Headline;
}

export interface QualityNote {
  id: string;
  tone: "info" | "warn";
  text: string;
  snippet?: { label: string; code: string };
}

export interface TreeRow {
  threadId: string;
  parentThreadId: string | null;
  title: string;
  /** The title is bb's fallback from the first prompt; exports use the id instead. */
  titleFromPrompt: boolean;
  providerId: string | null;
  depth: number;
  status: string | null;
  hidden: boolean;
  archived: boolean;
  deleted: boolean;
  state: AttributionState;
  billing: BillingMode;
  ownChip: string;
  ownUsd: number;
  ownTokens: number;
  familyChip: string;
  familyUsd: number;
  familyTokens: number;
  /** Share of the root family's total (dollars when any, else tokens). */
  share: number;
}

export interface ForkRow {
  threadId: string;
  title: string;
  titleFromPrompt: boolean;
  providerId: string | null;
  chip: string;
  usd: number;
  tokens: number;
  sideChat: boolean;
}

export interface GatewayBanner {
  check: ConnectionCheckId;
  message: string;
  since: number;
}

/** What the model knows about the public price lists, before `now` is applied. */
export interface PricesMeta {
  /** When LiteLLM's list was last fetched and is in use; null when the bundled snapshot is. */
  litellmAt: number | null;
  modelsDevAt: number | null;
  bundledDate: string | null;
  refreshOn: boolean;
  /** The last failed refresh, e.g. "LiteLLM: HTTP 503"; null when the last one succeeded. */
  lastError: string | null;
}

/** How fresh the estimates' prices are. */
export interface PricesInfo {
  /** Last successful refresh of the public list; null when none ever succeeded. */
  updatedAt: number | null;
  bundledDate: string | null;
  refreshOn: boolean;
  /** No successful refresh in over 7 days, or none at all. */
  stale: boolean;
  lastError: string | null;
}

export interface PriceSourceInfo {
  source: PriceOrigin;
  /** The name the price was found under, e.g. "claude-opus-5-5" for an alias. */
  as: string;
  /** When that list was fetched; null for overrides, the gateway and the bundled snapshot. */
  fetchedAt: number | null;
}

export interface ThreadReport {
  threadId: string;
  title: string;
  titleFromPrompt: boolean;
  providerId: string | null;
  projectId: string | null;
  generatedAt: number;
  currency: string;
  prices: PricesInfo & {
    /** Per model of the family's By-model table; a model with no price is absent. */
    models: Record<string, PriceSourceInfo>;
  };
  thread: FigureView;
  family: FigureView;
  descendants: number;
  hiddenDescendants: number;
  state: AttributionState;
  billing: BillingMode;
  stateMessage: string | null;
  firstSeenAt: number | null;
  turns: TurnView[];
  tree: TreeRow[];
  forks: ForkRow[];
  quality: QualityNote[];
  gatewayBanner: GatewayBanner | null;
  budget: { amount: number; crossedAt: number } | null;
}

export interface ChipView {
  visible: boolean;
  chip: string;
  headline: FigureView["headline"];
  tokens: Figure["tokens"];
  untrackedTokens: number;
  descendants: number;
  hiddenDescendants: number;
  turns: number;
  attention: boolean;
  /** A budget toast this window should show once, or null. */
  toast: { amount: number; total: string; title: string; rootThreadId: string } | null;
}

export interface TopFamily {
  threadId: string;
  title: string;
  providerId: string | null;
  projectId: string | null;
  headline: FigureView["headline"];
  usd: number;
  /** Dollars billed (gateway, API key or unknown); `usd` minus the subscription's list-price part. */
  billedUsd: number;
  /** List-price equivalent of the family's subscription use. */
  listPriceUsd: number;
  tokens: number;
  descendants: number;
  lastActivityAt: number | null;
  billing: BillingMode | "mixed";
}

export interface SettingsStatus {
  adapter: "none" | "litellm";
  snapshot: {
    commit: string;
    date: string | null;
    models: number;
    online: boolean;
    onlineFetchedAt: number | null;
    modelsDevFetchedAt: number | null;
    lastError: string | null;
  };
  backfill: { queued: number; running: number; done: number; failed: number; paused: boolean; failures: { threadId: string; kind: string; error: string | null }[] };
  gateway: { lastSweepAt: number | null; lastError: GatewayBanner | null; rows: boolean };
  logsMissing: { threadId: string; host: string; since: number }[];
  threadsTracked: number;
}

export type { ConnectionCheck };
