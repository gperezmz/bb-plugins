/**
 * Shapes the backend sends to the frontend, the CLI and the agent tool.
 * Type-only: the frontend imports these without pulling in server code.
 */
import type { BillingMode } from "./billing";
import type { Headline } from "./format";
import type { PriceOrigin } from "./pricing";
import type { Figure, TurnView } from "./summary";

export interface FigureView {
  figure: Figure;
  headline: Headline;
}

export interface QualityNote {
  id: string;
  tone: "info" | "warn";
  text: string;
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
  billing: BillingMode;
  ownChip: string;
  ownUsd: number;
  ownTokens: number;
  treeChip: string;
  treeUsd: number;
  treeTokens: number;
  /** Share of the root tree's total (dollars when any, else tokens). */
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

/** What the model knows about the models.dev list, before `now` is applied. */
export interface PricesMeta {
  /** When the list in use was fetched; null when the bundled copy is in use. */
  modelsDevAt: number | null;
  bundledDate: string | null;
  refreshOn: boolean;
  /** The last failed refresh, e.g. "HTTP 503"; null when the last one succeeded. */
  lastError: string | null;
}

/** How fresh the estimates' prices are. */
export interface PricesInfo {
  /** When the models.dev list in use was fetched; null when the bundled copy is in use. */
  updatedAt: number | null;
  bundledDate: string | null;
  refreshOn: boolean;
  /** No successful refresh in over 7 days, or none at all. */
  stale: boolean;
  lastError: string | null;
}

export interface PriceSourceInfo {
  source: PriceOrigin;
  /** The name the price was found under, e.g. "claude-opus-5-5" for a model id with a date. */
  as: string;
  /** When that list was fetched; null for the bundled copy. */
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
    /** Per model of the tree's By-model table; a model with no price is absent. */
    models: Record<string, PriceSourceInfo>;
  };
  thread: FigureView;
  treeTotal: FigureView;
  descendants: number;
  hiddenDescendants: number;
  billing: BillingMode;
  firstSeenAt: number | null;
  turns: TurnView[];
  tree: TreeRow[];
  forks: ForkRow[];
  quality: QualityNote[];
  budget: { amount: number; crossedAt: number } | null;
}

export interface ChipView {
  visible: boolean;
  chip: string;
  headline: FigureView["headline"];
  tokens: Figure["tokens"];
  descendants: number;
  hiddenDescendants: number;
  turns: number;
  attention: boolean;
  /** A budget toast this window should show once, or null. */
  toast: { amount: number; total: string; title: string; rootThreadId: string } | null;
}

export interface TopTree {
  threadId: string;
  title: string;
  providerId: string | null;
  projectId: string | null;
  headline: FigureView["headline"];
  usd: number;
  /** Dollars billed (API key or unknown); `usd` minus the subscription's list-price part. */
  billedUsd: number;
  /** List-price equivalent of the tree's subscription use. */
  listPriceUsd: number;
  tokens: number;
  descendants: number;
  lastActivityAt: number | null;
  billing: BillingMode | "mixed";
}

/**
 * Trees ranked by their dollars, and apart from them the trees that have
 * tokens and no priced token, ordered by tokens. Each list is cut to the
 * limit on its own.
 */
export interface TopTrees {
  priced: TopTree[];
  notPriced: TopTree[];
}

export interface SettingsStatus {
  prices: PricesInfo & {
    /** Models in the list in use. */
    models: number;
  };
  backfill: { queued: number; running: number; done: number; failed: number; paused: boolean; failures: { threadId: string; kind: string; error: string | null }[] };
  logsMissing: { threadId: string; host: string; since: number }[];
  threadsTracked: number;
}
