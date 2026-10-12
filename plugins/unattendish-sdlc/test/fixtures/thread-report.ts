// An answer shaped like the `report` RPC of the Thread Usage plugin in this
// repository (`plugins/thread-usage/src/core/report-types.ts`, `ThreadReport`):
// every field of the real answer, with the cost sources of the tree total the
// ones Fleet adds up. Written by hand, since Thread Usage publishes no
// contract: when its report changes shape, this is what to update, and
// `thread-usage-cost.test.ts` is what shows whether Fleet still reads it.
const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 };
const ZERO_COST = { gateway: 0, harness: 0, estimate: 0 };

const figure = (cost: { gateway: number; harness: number; estimate: number }) => ({
  tokens: { ...ZERO_TOKENS, input: 1200, output: 340 },
  untrackedTokens: 0,
  cost,
  unpricedTokens: 0,
  unpricedModels: [] as string[],
  approximate: false,
  apiMs: null,
  wallMs: 91_000,
  linesAdded: 12,
  linesRemoved: 3,
  turns: 4,
  requests: 9,
  partial: false,
  byModel: [{ model: "claude-opus-5-5", tokens: { ...ZERO_TOKENS, input: 1200, output: 340 }, gatewayTokens: 0, cost, unpricedTokens: 0 }],
  byBilling: {
    gateway: { tokens: 0, usd: 0, cost: ZERO_COST },
    "api-key": { tokens: 1540, usd: cost.gateway + cost.harness + cost.estimate, cost },
    subscription: { tokens: 0, usd: 0, cost: ZERO_COST },
    unknown: { tokens: 0, usd: 0, cost: ZERO_COST },
  },
});

const headline = (usd: number) => ({ primary: `$${usd.toFixed(2)}`, primaryKind: "usd" as const, detail: "api-key", secondary: null, unpricedNote: null, chip: `$${usd.toFixed(2)}`, billing: "api-key" as const });

/** A report whose tree total is made of the three cost sources given. */
export const threadReport = (treeCost: { gateway: number; harness: number; estimate: number }, over: Record<string, unknown> = {}) => {
  const usd = treeCost.gateway + treeCost.harness + treeCost.estimate;
  return {
    threadId: "thr_manager",
    title: "Manager",
    titleFromPrompt: false,
    providerId: "claude-code",
    projectId: "proj_1",
    generatedAt: 1_792_000_000_000,
    currency: "USD",
    prices: { updatedAt: null, bundledDate: "2026-10-01", refreshOn: true, stale: false, lastError: null, models: { "claude-opus-5-5": { source: "snapshot", as: "claude-opus-5-5", fetchedAt: null } } },
    thread: { figure: figure({ gateway: 0, harness: 0, estimate: 0.5 }), headline: headline(0.5) },
    treeTotal: { figure: figure(treeCost), headline: headline(usd) },
    descendants: 3,
    hiddenDescendants: 0,
    state: "tagged",
    billing: "api-key",
    stateMessage: null,
    firstSeenAt: 1_791_990_000_000,
    turns: [],
    tree: [],
    forks: [],
    quality: [],
    gatewayBanner: null,
    budget: null,
    ...over,
  };
};
