# Thread Usage

Shows what a thread and every thread it spawned cost, in tokens and dollars,
and how long it took. A coin in the thread header opens a Usage tab with the
tree's tokens, cost by model, cost per turn and the child threads; a Thread
usage page ranks the costliest thread trees; `bb thread-usage` and an agent
tool answer the same from the CLI. Cost comes from a LiteLLM gateway when one
is set, else the harness, else tokens times list price, marked as an
estimate.

## Sub-features

- `chip`: the header coin, `Usage: <figure>[ with N child thread(s)]`.
- `tab`: the Usage tab, with the Scope toggle `This thread` /
  `With children` (only on a thread with children), cost by model, cost per
  turn and the `Child threads` tree.
- `page`: the Thread usage page, with `Project` and `Period` filters.
- `cli`: `bb thread-usage show [<thread>] [--no-children] [--json]` and
  `top [--since 7d] [--json]`.
- `budget`: `warnAbove` tints the coin and toasts once per tree.

## How to get to it (user POV)

- A thread's header: `button` named `Usage: …`, drawn once the tree has a
  turn or any usage. Hovering it 250 ms opens a card with the tokens and the
  child count; clicking it opens the Usage tab.
- The command palette in a thread: `Show usage for this thread`.
- `navigation "Primary navigation"` → `button "Thread usage"`: the page, at
  `/plugins/thread-usage/usage`, with `combobox "Project"` and
  `radiogroup "Period"` (`7 days`, `30 days`).
- Settings → Installed plugins → Thread Usage, at
  `/settings/plugins/thread-usage`: the plugin's settings and the
  `Gateway, history and export` section.
- CLI: `bb thread-usage show|top`; RPC `report {threadId}`,
  `refresh {threadId}`, `top {projectId, sinceDays}`, `status`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start thread-usage`, then, before any
thread:
`drive-bb-plugins bb thread-usage/setup -- plugin config thread-usage set refreshPrices false`
and
`drive-bb-plugins bb thread-usage/setup -- plugin config thread-usage set billingClaudeCode api-key`.

Every UI step is a verb, `drive-bb-plugins thread-usage <verb>`, which prints
JSON of what the page showed and what `thread-usage show` or `top` reports
as `stored`; the command with no verb lists them. `tab` and `palette` read a
thread with child threads, since the tab draws Scope and Child threads only
then.

- **A tree** (`thread-usage.tab/spawn`):
  `P=$(drive-bb-plugins spawn thread-usage.tab/spawn parent hello)` and
  `C=$(drive-bb-plugins spawn thread-usage.tab/spawn child hello "$P")`.
- **CLI roll-up** (`thread-usage.cli/cli`):
  `drive-bb-plugins bb thread-usage.cli/cli -- thread-usage show "$P" --json`
  has `descendants` 1 and `$C` among `.children[].threadId`; with
  `--no-children` it has `descendants` 0 and a lower `usd`.
- **Chip and tab** (`thread-usage.chip/header`):
  `thread-usage tab "$P" --this-thread --child child` opens the parent
  thread, reads `chip.name` `Usage: <figure> with 1 child thread`, clicks it
  and reads the Usage tab: `scope` `With children`, the headline, `models`
  (`By model`'s rows), `turns` (the per-turn bars, `button`s named
  `Turn N: <value>`) and `children` (a `treeitem` for `child`). `thisThread`
  then reads a lower headline noting `With children: <previous figure>`, and
  `child.url` is `$C`'s thread.
- **Page** (`thread-usage.page/nav`): `thread-usage page --period "30 days"`
  clicks `button "Thread usage"` in `navigation "Primary navigation"` (or its
  `More` menu) and reads `parent` first in `shown.trees` and `after.trees`;
  `stored`, `thread-usage top --json`, has `.trees[0].threadId` equal to
  `$P`. `--project drives` picks the project.
- **Palette** (`thread-usage.tab/palette`): `thread-usage palette "$P"`
  presses Control+K, which opens bb's `dialog "Quick palette"` on
  `combobox "Search threads"`, then Escape, which switches it to
  `combobox "Search commands"`, and picks
  `option "Show usage for this thread"`: `tab.scope` `With children`.
- **Budget** (`thread-usage.budget/header`): `thread-usage budget "$P" tint`
  sets `warnAbove` 0.01, under the tree's billed dollars: the coin is tinted
  (`text-warning`) with no toast. `thread-usage budget "$P" toast` sets it
  just above them, tells `$P` `hello again` and waits it out with the parent's
  thread view open: one toast `“parent” crossed $<amount>`,
  `Now $<total>. Nothing was stopped.`

## Gotchas

- Install the plugin before spawning threads: threads older than the
  install are backfilled in the background, not at once.
- `spawn` returns once the first turn is idle, so the chip is there when a
  drive opens the thread.
- Without `billingClaudeCode api-key` the fake API's key reads as billing
  `unknown`: the headline still leads with dollars, and the detail line
  reads `estimate · billing unknown` for `estimate · API key`. Only
  subscription billing leads with tokens.
- With `refreshPrices` on, the plugin fetches prices from the network at
  start; off, it uses its bundled list.
- The hover card opens after 250 ms and stays shut after a click: open the
  tab by clicking the chip.
- `thread-usage show` and the `refresh` RPC catch up on bb's events before
  answering, so they are the read-back to trust over a UI that updates on a
  400 ms debounce.
- The page's nav entry is `Thread usage`; `Usage` is a different plugin.
