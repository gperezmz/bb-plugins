# Thread Usage: settings

Set these under Settings → Installed plugins → Thread Usage, or with `bb plugin config thread-usage set <key> <value>`. The plugin reads them on every call, so a change takes effect without a reload. Source: [`src/server/settings.ts`](../../plugins/thread-usage/src/server/settings.ts).

| Key | Label | Default | Values |
|---|---|---|---|
| `refreshPrices` | Refresh prices online | `true` | Fetch models.dev's price list daily; `false` uses the bundled list |
| `readLogs` | Read harness logs | `true` | Read session logs on the machine that ran a thread: Claude Code subagent tokens, history from before install, and which cache writes were 1-hour ones |
| `billingClaudeCode` | Billing for Claude Code | `auto` | `auto`, `api-key`, `subscription` |
| `billingCodex` | Billing for Codex | `auto` | as above |
| `billingPi` | Billing for pi | `auto` | as above |
| `billingOther` | Billing for other harnesses | `auto` | as above |
| `showAmount` | Show amount in header | `false` | Show the thread tree total inside the header chip, after the coin |
| `warnAbove` | Warn above | `0` | A thread tree's billed total (the list-price equivalent of subscription use left out) that, once crossed, tints the coin and shows one toast per tree and amount. A tree already over the amount when the plugin starts or the amount changes gets the tint without the toast. `0` turns it off |
| `currency` | Currency label | `$` | The label only, 1 to 12 characters; figures are USD |

**Billing for** overrides the [billing mode](thread-usage-cost-sources.md#billing-modes) the plugin detects.

Earlier versions also had a gateway adapter and URL, a gateway read key, extra Claude Code headers, and price overrides and aliases. The plugin no longer declares or reads them, and deleted the gateway rows it had stored when it first loaded. A read key an earlier version saved stays in bb's secrets file, which the plugin does not read or delete.

## The settings section

Below the declared settings, the plugin adds a section, **History, prices and export**, with what the settings cannot hold. Source: [`src/ui/SettingsPanel.tsx`](../../plugins/thread-usage/src/ui/SettingsPanel.tsx).

| Part | Holds |
|---|---|
| History backfill | Progress of reading bb's events and harness logs for older threads and gaps, with **Pause** or **Resume**, **Retry failed** when a read failed, and the machines whose logs could not be read |
| Prices | The [freshness line](thread-usage-cost-sources.md#price-freshness) for models.dev's list in use: when it was fetched, whether the bundled copy is in use, and, when the last refresh failed, that it failed and why |
| Export all | Every thread total and turn record, as JSON or CSV. Carries no prompt text, and leaves out titles bb made from a thread's first prompt |

The Usage tab exports one thread: **Copy as Markdown** and **Download CSV**.
