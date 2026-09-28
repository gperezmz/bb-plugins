# Thread Usage: `bb thread-usage`

The CLI runs on the bb server and reads the same records as the Usage tab. Source: [`server.ts`](../../plugins/thread-usage/server.ts).

## `bb thread-usage show`

```text
bb thread-usage show [<threadId>] [--no-children] [--json]
```

Shows one thread's usage, added up over its [tree](../explanation/how-the-plugins-fit-bb.md#threads-and-trees). Before answering, it reads any events bb has for the thread that the plugin has not read yet.

| Argument or option | Meaning |
|---|---|
| `<threadId>` | The thread. Defaults to the thread the command runs in |
| `--no-children` | This thread only, without its descendants |
| `--json` | Machine-readable output |

The text output gives the headline, tokens by kind, turns, wall time, API time (gateway only), lines changed, the [billing mode](thread-usage-cost-sources.md#billing-modes) and the [attribution state](thread-usage-cost-sources.md#attribution-states).

`--json` fields:

| Field | Meaning |
|---|---|
| `threadId`, `title` | The thread |
| `scope` | `tree`, or `thread` with `--no-children` |
| `descendants` | Number of threads under it; `0` with `--no-children` |
| `headline` | The [headline](../explanation/thread-usage-counting.md#billed-and-subscription-use) as the Usage tab shows it: `primary` (the large figure), `primaryKind` (`usd` or `tokens`), `detail` (source and billing), `secondary` (subscription tokens beside billed dollars, or `null`), `unpricedNote`, `chip` (the header chip's short figure), `billing` (the figure's billing mode, `mixed` when the tree's threads differ) |
| `usd` | Total dollars, list-price equivalent of subscription use included |
| `billedUsd` | Dollars actually billed: `usd` without subscription use |
| `listPriceUsd` | List-price equivalent of subscription use |
| `cost` | Dollars by [cost source](thread-usage-cost-sources.md#cost-sources): `gateway`, `harness`, `estimate` |
| `tokens` | Tokens by kind: `input`, `output`, `cacheRead`, `cacheWrite`, `cacheWrite1h`, `reasoning`. `cacheWrite1h` is the part of `cacheWrite` known to be 1-hour writes, and `reasoning` is part of `output` |
| `totalTokens` | `input` + `output` + `cacheRead` + `cacheWrite`, plus `untrackedTokens` |
| `unpricedTokens` | Tokens with no price |
| `untrackedTokens` | Tokens the gateway reported beyond what bb and the logs saw |
| `billing` | This thread's own billing mode; the tree's is `headline.billing` |
| `state` | This thread's attribution state |
| `turns`, `wallMs`, `apiMs`, `lines` | Turn count, wall and API time in milliseconds, lines `added` and `removed` |
| `children` | One entry per descendant: `threadId`, `title`, `depth`, `usd`, `treeUsd`, `tokens`; empty with `--no-children` |
| `pricesUpdatedAt` | When LiteLLM's price list was last fetched, ISO time; `null` if never, or while **Refresh prices online** is off |

A turn still running counts nothing yet: harnesses report a turn's tokens when it ends.

| Error | When |
|---|---|
| `no thread id given` | No `<threadId>`, and the command does not run in a thread |
| `no thread <threadId>` | bb has no such thread |

## `bb thread-usage top`

```text
bb thread-usage top [--project <id>] [--since <duration>] [--limit <1-200>] [--json]
```

Lists the most expensive thread trees, ranked by all their dollars, list-price equivalent of subscription use included. The Thread usage page in the sidebar shows the same list.

| Option | Default | Meaning |
|---|---|---|
| `--project <id>` | all projects | Only thread trees in this project |
| `--since <duration>` | `7d` | Thread trees active within this window, e.g. `7d`, `30d`. A number without a unit is days |
| `--limit <n>` | `20` | How many thread trees, 1 to 200 |
| `--json` | | Machine-readable output |

Each line gives the dollars, tokens, the root's title and id, and the tree's thread count; the second line gives the project and the last activity. With no tree in the window it prints `No thread trees with usage in that window.`

`--json` prints `{ trees, pricesUpdatedAt }`. Each tree has `threadId`, `title`, `projectId`, `providerId`, `descendants`, `usd`, `billedUsd`, `listPriceUsd`, `tokens`, `billing`, `headline` and `lastActivityAt` (epoch milliseconds, or `null`).
