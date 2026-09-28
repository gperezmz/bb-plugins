# Thread Usage: settings

Set these under Settings → Installed plugins → Thread Usage, or with `bb plugin config thread-usage set <key> <value>`. The plugin reads them on every call, so a change, a rotated read key included, takes effect without a reload. Source: [`src/server/settings.ts`](../../plugins/thread-usage/src/server/settings.ts).

| Key | Label | Default | Values |
|---|---|---|---|
| `adapter` | Gateway adapter | `none` | `none` estimates cost from tokens; `litellm` reads spend per thread from a LiteLLM gateway |
| `gatewayUrl` | Gateway URL | empty | Base URL of the LiteLLM proxy that serves `/spend/logs/v2`, e.g. `https://llm.example.com`. Must be an `http` or `https` URL |
| `readKey` | Gateway read key | not set | Secret. A read-only `proxy_admin_viewer` key, or an `internal_user` key. Kept on the bb server, never sent to a window |
| `extraHeaders` | Extra Claude Code headers | empty | Headers merged into `ANTHROPIC_CUSTOM_HEADERS`, one `Name: Value` per line; blank lines and lines starting with `#` are skipped. Refused: `x-litellm-session-id`, which the plugin sets, and credential headers: `Authorization`, `Proxy-Authorization`, `Cookie`, and any name with `key`, `api-key`, `secret`, `token`, `auth`, `password`, `passwd` or `credentials` as one of its dash-separated parts |
| `priceOverrides` | Price overrides and aliases | empty | JSON; see [set price overrides and aliases](../how-to/thread-usage-set-prices.md) |
| `refreshPrices` | Refresh prices online | `true` | Fetch the public price lists daily; `false` uses the bundled list |
| `readLogs` | Read harness logs | `true` | Read session logs on the machine that ran a thread |
| `billingClaudeCode` | Billing for Claude Code | `auto` | `auto`, `gateway`, `api-key`, `subscription` |
| `billingCodex` | Billing for Codex | `auto` | as above |
| `billingPi` | Billing for pi | `auto` | as above |
| `billingOther` | Billing for other harnesses | `auto` | as above |
| `showAmount` | Show amount in header | `false` | Show the thread tree total inside the header coin's button, after the coin |
| `warnAbove` | Warn above | `0` | A thread tree's billed total (the list-price equivalent of subscription use left out) that, once crossed, tints the coin and shows one toast per tree and amount. A tree already over the amount when the plugin starts or the amount changes gets the tint without the toast. `0` turns it off |
| `currency` | Currency label | `$` | The label only, 1 to 12 characters; figures are USD |

The `extraHeaders` values appear in bb's thread timeline, which is why credentials are refused there. The plugin's own value replaces any `ANTHROPIC_CUSTOM_HEADERS` your shell sets, so list those headers here too.

**Billing for** overrides the [billing mode](thread-usage-cost-sources.md#billing-modes) the plugin detects, for threads not billed through the gateway.

## The settings section

Below the declared settings, the plugin adds a section, **Gateway, history and export**, with what the settings cannot hold. Source: [`src/ui/SettingsPanel.tsx`](../../plugins/thread-usage/src/ui/SettingsPanel.tsx).

| Part | Holds |
|---|---|
| Gateway connection | With the adapter set to `litellm`, **Test connection**. Its four checks run in order, and a failed one skips the rest: **Gateway URL answers** (any HTTP answer from `/health/liveliness`); **Read key is valid** (`/key/info` does not answer `401` or `403`); **Key may read /spend/logs/v2**; **Key sees bb- rows in the last 7 days**, a warning rather than a failure while the plugin has recorded no thread yet |
| Tag requests from Codex and pi | The config line each needs, with a copy button |
| History backfill | Progress of reading bb's events and harness logs for older threads and gaps, with **Pause** or **Resume**, **Retry failed** when a read failed, and the machines whose logs could not be read |
| Prices | Which price lists are in use and when each was fetched, the last refresh error, and the last gateway sweep |
| Export all | Every thread total, turn record and gateway row, as JSON or CSV. Carries no prompt text, and leaves out titles bb made from a thread's first prompt |

The Usage tab exports one thread: **Copy as Markdown** and **Download CSV**.
