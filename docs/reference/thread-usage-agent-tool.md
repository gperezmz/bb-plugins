# Thread Usage: the `thread_usage` agent tool

Every thread's agent gets one tool from Thread Usage. Source: [`server.ts`](../../plugins/thread-usage/server.ts).

| | |
|---|---|
| Name | `thread_usage` |
| Description the agent sees | Cost and tokens of this thread plus every thread it spawned, with cost source and billing mode. |
| Parameters | none |
| Returns | JSON for the calling thread's [family](../explanation/how-the-plugins-fit-bb.md#threads-and-families) |

The plugin's agent skill tells agents how to read the result, and when to use `bb thread-usage` instead.

## Result

| Field | Meaning |
|---|---|
| `threadId` | The calling thread |
| `scope` | Always `family` |
| `descendants` | Number of threads under it |
| `headline` | The [headline](../explanation/thread-usage-counting.md#billed-and-subscription-use) as one line of text |
| `usd` | Total dollars, list-price equivalent of subscription use included |
| `billedUsd` | Dollars actually billed |
| `listPriceUsd` | List-price equivalent of subscription use |
| `costBySource` | Dollars by [cost source](thread-usage-cost-sources.md#cost-sources): `gateway`, `harness`, `estimate` |
| `tokens` | Total tokens |
| `unpricedTokens` | Tokens with no price |
| `billing` | The family's [billing mode](thread-usage-cost-sources.md#billing-modes), `mixed` when its threads differ |
| `thisThreadUsd` | Dollars for the calling thread alone |
| `pricesUpdatedAt` | When LiteLLM's price list was last fetched, ISO time; `null` if never |

The calling thread's own current turn is not in the figures until it ends.
