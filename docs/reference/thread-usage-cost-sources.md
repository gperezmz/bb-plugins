# Thread Usage: cost sources, prices and billing

Why these exist is in [how Thread Usage counts tokens and cost](../explanation/thread-usage-counting.md). Sources: [`src/core/summary.ts`](../../plugins/thread-usage/src/core/summary.ts), [`src/core/pricing.ts`](../../plugins/thread-usage/src/core/pricing.ts), [`src/core/billing.ts`](../../plugins/thread-usage/src/core/billing.ts).

## Cost sources

Each turn is `estimate`, or `unpriced`. The Usage tab labels a turn's source and colours its bar by it.

| Source | When |
|---|---|
| `estimate` | Tokens and a price from models.dev are known: tokens times the price |
| `unpriced` | Tokens are known, no price is |

The report's cost has three amounts, `gateway`, `harness` and `estimate`. Another plugin in this repository adds the three together for a fleet's cost, so they stay. `gateway` and `harness` are always zero, and `estimate` is every dollar.

## How a request is priced

A turn recorded from bb's per-request usage events is priced one request at a time, and its dollars are the sum of its requests. A request a harness log records, such as a subagent's, is priced the same way. A request's **prompt** is its uncached input plus its cache read plus its cache write; output is not part of it.

| Input | Rule |
|---|---|
| Tier | A model's `cost.tiers` entries whose type is `context`, at whatever size models.dev publishes. Entries of another type are not used |
| Which tier | The tier with the highest size the request's prompt is over: strictly over, so a prompt equal to the size is at the base rates |
| Its rates | Every kind the tier sets replaces the base rate, for the whole request, output included. A kind the tier omits keeps the base rate |
| A 1-hour cache write, Claude | Twice the input rate of the tier in effect, or of the base when no tier applies. models.dev publishes only the 5-minute rate |
| A 1-hour cache write, other models | The cache-write rate of the tier in effect, marked approximate |

A turn bb recorded takes its 1-hour cache writes as that turn's share of its cache writes, because a log line cannot be matched to one of bb's requests. They are priced as a line of their own, at twice the input rate its requests used, which is the highest of them, marked approximate, when they used more than one.

A turn with no per-request counts uses the base rates and is marked approximate where its model has a tier:

- a turn stored as a sum, from before requests were kept;
- a turn filled in from bb's running total;
- a Claude Code turn, because bb reports one usage event for the whole turn;
- an opening balance, and a turn older than a year, collapsed by retention.

A model with a tier needs per-request counts for a tier to apply, so [Data quality](../tutorials/thread-usage-first-run.md#4-open-the-usage-tab) says those turns may be low. A turn whose per-request counts are known is priced per request.

## Price sources

An estimate takes its price from models.dev's list:

| Copy | When |
|---|---|
| Fetched | A fetch has succeeded, and **Refresh prices online** is on. The plugin fetches again after 24 hours |
| Bundled | No fetch has succeeded, or **Refresh prices online** is off. The copy shipped with the plugin |

A copy of models.dev's list stored by an earlier version of the plugin is not used. When several providers list a model id, the maker's price is used, and otherwise the median of the others'. Nothing else supplies a price: not a harness's own cost, not a setting.

The bracketed suffix harnesses add to a model name (`claude-opus-5-5[1m]`) is dropped before the lookup, and case is ignored. The list is then tried under the name itself, without a provider prefix such as `anthropic/`, `bedrock/` or `openrouter/<vendor>/`, under its last slash-separated segment, with a Vertex `@date` read as `-date`, and without a trailing `-YYYYMMDD` date. When a turn falls back to another model, it is priced as the model that answered. A model models.dev does not list is `unpriced`.

## Price freshness

With **Refresh prices online** on (the default), the plugin fetches the list when it starts, if its copy is more than 24 hours old, and then daily; a failed fetch is retried hourly and the last good copy is kept.

Every estimate says where its prices come from and how fresh they are:

| Prices | The Usage tab, the Thread usage page, the settings section and the Markdown export say |
|---|---|
| Fetched within 7 days | Estimated with models.dev prices, fetched *time* ago |
| Fetched more than 7 days ago | Estimated with models.dev prices, fetched *time* ago. They are more than a week old and may be out of date |
| Never fetched, setting on | Estimated with the models.dev list bundled with the plugin (*date*); it has not been fetched yet, so prices may be out of date |
| Setting off | Estimated with the models.dev list bundled with the plugin (*date*). Online updates are off, so prices may be out of date |

When the last refresh failed, each also says so: *The last refresh failed: error*.

The tooltip on each model's cost in the Usage tab names the list and when it was fetched, and the **Source** column says `models.dev`, or `models.dev, bundled`. `bb thread-usage show --json`, `bb thread-usage top --json` and the `thread_usage` tool carry `pricesUpdatedAt`: when models.dev's list was fetched, as an ISO time, or `null` when it never was or the setting is off. The report names each model's price source as `models.dev` for the fetched list and `snapshot` for the bundled copy.

## Billing modes

How a thread's tokens are paid for. Decided in this order:

1. The **Billing for** setting of the thread's harness, when it is not `auto`. A choice saved as `gateway` by an earlier version reads as `auto`.
2. `subscription`, when the thread is routed through bb's account pool.
3. From the harness's rate-limit events: a subscription window means `subscription`; spend control or credits mean `api-key`. A thread with no such event takes the last kind another thread of the same harness reported.
4. `unknown`.

| Mode | Headline |
|---|---|
| `api-key` | Dollars, labelled estimate |
| `unknown` | Dollars, labelled estimate, with "Billing unknown: set it in settings" under **Data quality** |
| `subscription` | Tokens; dollars smaller, as a list-price equivalent at models.dev's prices |

A tree whose threads are billed differently is `mixed`: its headline is the billed dollars, with subscription tokens on a second line.

## Unpriced tokens

| Thread | Headline |
|---|---|
| No tokens | A dash, and "No usage recorded" |
| Tokens, every one unpriced | The token count, large and on the header chip, with a line saying the tokens are not priced. Data quality names the model and says models.dev is where a price would come from |
| Subscription, some tokens unpriced | The token count, with the unpriced tokens named beside it |
| API key or unknown, some tokens priced | The dollars, with the unpriced tokens named beside them |

On the Thread usage page and in `bb thread-usage top`, trees that have dollars are ranked by those dollars, subscription list price included. A tree that has tokens and none priced is listed apart, under **Not priced**, ordered by tokens, with its token count as its figure and no bar. Each list ranks from 1.
