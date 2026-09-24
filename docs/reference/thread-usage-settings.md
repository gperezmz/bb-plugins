# Thread Usage: settings

Set these under Settings → Installed plugins → Thread Usage, or with `bb plugin config thread-usage set <key> <value>`. The plugin reads them on every call, so a change, a rotated read key included, takes effect without a reload. Source: [`src/server/settings.ts`](../../plugins/thread-usage/src/server/settings.ts).

| Key | Label | Default | Values |
|---|---|---|---|
| `adapter` | Gateway adapter | `none` | `none` estimates cost from tokens; `litellm` reads spend per thread from a LiteLLM gateway |
| `gatewayUrl` | Gateway URL | empty | Base URL of the LiteLLM proxy that serves `/spend/logs/v2`, e.g. `https://llm.example.com` |
| `readKey` | Gateway read key | not set | Secret. A read-only `proxy_admin_viewer` key, or an `internal_user` key. Kept on the bb server, never sent to a window |
| `extraHeaders` | Extra Claude Code headers | empty | Headers merged into `ANTHROPIC_CUSTOM_HEADERS`, one `Name: Value` per line. Authorization, API key, cookie and token headers are refused |
| `priceOverrides` | Price overrides and aliases | empty | JSON; see [set price overrides and aliases](../how-to/thread-usage-set-prices.md) |
| `refreshPrices` | Refresh prices online | `true` | Fetch the public price lists daily; `false` uses the bundled list |
| `readLogs` | Read harness logs | `true` | Read session logs on the machine that ran a thread |
| `billingClaudeCode` | Billing for Claude Code | `auto` | `auto`, `gateway`, `api-key`, `subscription` |
| `billingCodex` | Billing for Codex | `auto` | as above |
| `billingPi` | Billing for pi | `auto` | as above |
| `billingOther` | Billing for other harnesses | `auto` | as above |
| `showAmount` | Show amount in header | `false` | Show the family total beside the header coin |
| `warnAbove` | Warn above | `0` | A family total that, once crossed, tints the coin and shows one toast. `0` turns it off |
| `currency` | Currency label | `$` | The label only; figures are USD |

The `extraHeaders` values appear in bb's thread timeline, which is why credentials are refused there. The plugin's own value replaces any `ANTHROPIC_CUSTOM_HEADERS` your shell sets, so list those headers here too.

**Billing for** overrides the [billing mode](thread-usage-cost-sources.md#billing-modes) the plugin detects, for threads not billed through the gateway.

## The settings section

Below the declared settings, the plugin adds sections the settings cannot hold:

| Section | Holds |
|---|---|
| Tag requests from Codex and pi | The config line each needs, with a copy button |
| Gateway connection | **Test connection**. It checks, each pass or fail: the gateway URL answers; the key is valid; the key may read `/spend/logs/v2`; the key can see at least one `bb-` row from the last 7 days (a warning, not a failure, before any thread has run) |
| History backfill | Progress of reading harness logs for older threads, with pause and resume |
| Prices | Which price lists are in use and when each was fetched, the last refresh error, and the last gateway sweep |
| Export all | Every thread total, turn record and gateway row, as JSON or CSV. Carries no prompt text |

The Usage tab exports one thread: **Copy as Markdown** and **Download CSV**.
