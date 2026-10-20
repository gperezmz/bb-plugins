# Thread Usage: the `thread_usage` agent tool

Every thread's agent gets one tool from Thread Usage. Source: [`server.ts`](../../plugins/thread-usage/server.ts).

| | |
|---|---|
| Name | `thread_usage` |
| Description the agent sees | Returns the tokens and dollars spent by this thread and every thread it spawned, with the billing mode. Dollars are an estimate from models.dev prices; tokens no price covers are counted and not priced. |
| Label in the timeline | Checking thread usage, then Checked thread usage |
| Parameters | none |
| Returns | JSON for the calling thread's [tree](../explanation/how-the-plugins-fit-bb.md#threads-and-trees), after reading any events bb has for the thread that the plugin has not read yet |

The plugin's agent skill tells agents how to read the result, and when to use `bb thread-usage` instead.

## Result

| Field | Meaning |
|---|---|
| `threadId` | The calling thread |
| `scope` | Always `tree` |
| `descendants` | Number of threads under it |
| `headline` | The [headline](../explanation/thread-usage-counting.md#billed-and-subscription-use) as one line of text |
| `usd` | Total dollars, list-price equivalent of subscription use included |
| `billedUsd` | Dollars actually billed |
| `listPriceUsd` | List-price equivalent of subscription use |
| `costBySource` | Dollars by [cost source](thread-usage-cost-sources.md#cost-sources): `gateway` and `harness`, always `0`, and `estimate`, every dollar |
| `tokens` | Total tokens |
| `unpricedTokens` | Tokens with no price on models.dev |
| `billing` | The tree's [billing mode](thread-usage-cost-sources.md#billing-modes), `mixed` when its threads differ |
| `thisThreadUsd` | Dollars for the calling thread alone |
| `pricesUpdatedAt` | When models.dev's price list was last fetched, ISO time; `null` if never, or while **Refresh prices online** is off, when the bundled copy is in use |

The calling thread's own current turn is not in the figures until it ends.
