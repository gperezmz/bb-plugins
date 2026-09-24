# Thread Usage: cost sources, prices, attribution and billing

Why these exist is in [how Thread Usage counts tokens and cost](../explanation/thread-usage-counting.md). Sources: [`src/core/summary.ts`](../../plugins/thread-usage/src/core/summary.ts), [`src/core/pricing.ts`](../../plugins/thread-usage/src/core/pricing.ts), [`src/core/attribution.ts`](../../plugins/thread-usage/src/core/attribution.ts).

## Cost sources

Each turn takes its cost from the first source in this order that has one. A thread or family figure can mix sources turn by turn, and the Usage tab shows the mix, for example `$4.12 (gateway) + $0.30 (estimate)`.

| # | Source | When | Exact |
|---|---|---|---|
| 1 | `gateway` | The gateway logged requests tagged with this thread inside the turn | Yes: what the gateway billed, with its own prices and aliases |
| 2 | `harness` | The harness logged a cost for the turn (pi) | Yes: what the harness reported |
| 3 | `estimate` | Tokens and a price are known | No: tokens × the price from the list below |
| 4 | `unpriced` | Tokens are known, no price is | – |

A gateway row or a harness cost of 0 on a turn with output tokens counts as `unpriced`: LiteLLM bills models it does not know at zero, and pi's custom models default to a cost of 0.

## Price sources

An estimate takes its price from the first of these that lists the model:

| # | Source | Note |
|---|---|---|
| 1 | Aliases from settings | Applied first: they rename the model, then the lookup continues |
| 2 | Price overrides from settings | USD per million tokens |
| 3 | The gateway's price map | From the gateway's `/model/info`, when the gateway adapter is on and exposes it. Not used for subscription use |
| 4 | LiteLLM's public price list | Fetched daily |
| 5 | models.dev's public price list | Fetched daily; used for models LiteLLM's list lacks |
| 6 | none | The turn is `unpriced` |

The bracketed suffix harnesses add to a model name (`claude-opus-5-5[1m]`) is dropped before the lookup. When a turn falls back to another model, it is priced as the model that answered.

Prices with a long-context tier apply the tier only to requests the gateway or the harness logs report one by one. A turn known only from bb's events uses the base rate, and is marked approximate when its model has a tier.

## Price freshness

With **Refresh prices online** on (the default), the plugin fetches both public lists when it starts, if its copy is more than 24 hours old, and then daily; a failed fetch is retried hourly and the last good copy is kept. Until the first fetch succeeds, and whenever the setting is off, it uses the copy of LiteLLM's list bundled with the plugin.

Every estimate says how fresh its prices are:

| Prices | The Usage tab, the Thread usage page and the Markdown export say |
|---|---|
| Fetched within 7 days | Estimated with public list prices, updated *time* ago |
| Fetched more than 7 days ago | Estimated with public list prices, last updated *time* ago. They are more than a week old and may be out of date (refresh failing: *error*) |
| Never fetched, setting on | Estimated with the price list bundled with the plugin (*date*); it has not been updated online yet, so prices may be out of date |
| Setting off | Estimated with the price list bundled with the plugin (*date*). Online updates are off, so prices may be out of date |

The tooltip on each model's cost in the Usage tab names the price source and when that list was fetched. `bb thread-usage show --json`, `bb thread-usage top --json` and the `thread_usage` tool carry `pricesUpdatedAt`: when LiteLLM's list was last fetched, as an ISO time, or `null` when it never was.

## Attribution states

Whether the gateway can find a thread's requests. Checked in this order; the first that holds wins.

| State | When | The Usage tab says |
|---|---|---|
| `no-adapter` | The gateway adapter is `none` | Nothing; cost is estimated |
| `unsupported` | The harness is Cursor | No token or cost data for Cursor |
| `tagged` | At least one gateway row names this thread. It stays `tagged` once reached | Nothing; the headline is the gateway cost |
| `account-pool` | bb's account-pool plugin routes the thread | Not via gateway: account pool |
| `not-routed` | The harness's base URL points somewhere other than the gateway | Not via gateway: requests go to *host* |
| `pending` | The thread has turns but no rows yet, and has been idle less than 60 s | Waiting for gateway spend… |
| `untagged` | Idle 60 s with output tokens and no rows | Codex and pi: Requests are not tagged. Add this line to *harness* config, with the line. Claude Code: No gateway spend for this thread: its turns ran before tagging was on, or its requests bypass the gateway |
| `no-usage` | No turns yet, or idle 60 s with no rows and no output tokens | Nothing |

A thread on a subscription never reaches a gateway, so it shows no note when `untagged`.

## Billing modes

How a thread's tokens are paid for. Decided in this order:

1. `gateway`, when the thread is `tagged`.
2. The **Billing for** setting of the thread's harness, when it is not `auto`.
3. `subscription`, when the thread is routed through bb's account pool.
4. From the harness's rate-limit events: a subscription window means `subscription`; spend control or credits mean `api-key`. A thread with no such event takes the last kind another thread of the same harness reported.
5. `unknown`.

| Mode | Headline |
|---|---|
| `gateway` | Dollars |
| `api-key` | Dollars, labelled estimate |
| `unknown` | Dollars, labelled estimate, with "Billing unknown: set it in settings" under **Data quality** |
| `subscription` | Tokens; dollars smaller, as a list-price equivalent priced from overrides and public lists only |

A family whose threads are billed differently is `mixed`: its headline is the billed dollars, with subscription tokens on a second line.
