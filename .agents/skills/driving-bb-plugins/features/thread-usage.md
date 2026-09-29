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
- `tab`: the Usage tab, with the Scope toggle `This thread` / `With
  children` and the `Child threads` tree.
- `page`: the Thread usage page, with `Project` and `Period` filters.
- `cli`: `bb thread-usage show [<thread>] [--no-children] [--json]` and
  `top [--since 7d] [--json]`.
- `budget`: `warnAbove` tints the coin and toasts once per tree.

## How to get to it (user POV)

- A thread's header: `button` named `Usage: …`, drawn once the tree has a
  finished turn. Clicking it opens the Usage tab.
- The command palette in a thread: `Show usage for this thread`.
- Sidebar navigation → `Thread usage`: the page, route `usage`.
- Settings → Installed plugins → Thread Usage, at
  `/settings/plugins/thread-usage`: the plugin's settings and the `Gateway,
  history and export` section.
- CLI: `bb thread-usage show|top`; RPC `report {threadId}`, `refresh
  {threadId}`, `top {projectId, sinceDays}`, `status`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start thread-usage`, then, before any
thread:
`drive-bb-plugins bb thread-usage/setup -- plugin config thread-usage set refreshPrices false`
and
`drive-bb-plugins bb thread-usage/setup -- plugin config thread-usage set billingClaudeCode api-key`.

- **A tree** (`thread-usage.tab/spawn`):
  `P=$(drive-bb-plugins spawn thread-usage.tab/spawn parent hello)` and
  `C=$(drive-bb-plugins spawn thread-usage.tab/spawn child hello "$P")`.
- **CLI roll-up** (`thread-usage.cli/cli`):
  `drive-bb-plugins bb thread-usage.cli/cli -- thread-usage show "$P" --json`
  has `descendants` 1 and `$C` among `.children[].threadId`; with
  `--no-children` it has `descendants` 0 and a lower `usd`.
- **Chip and tab** (`thread-usage.chip/header`): a `ui` script opens the
  parent thread (its row in the sidebar, or `url + "thread/" + P` where that
  route answers), finds `button` named `/^Usage: .* with 1 child thread/`,
  captures, clicks it, and finds `group "Scope"` with `With children`
  selected and `heading "Child threads"` with a `treeitem` for `child`;
  clicking `This thread` lowers the headline figure and shows `With
  children: <previous figure>`.
- **Page** (`thread-usage.page/nav`): a `ui` script clicks `button "Thread
  usage"` in `navigation "Sidebar navigation"` (or the `More sidebar
  navigation` menu), and finds `parent` ranked first;
  `thread-usage top --json` has `.trees[0].threadId` equal to `$P`.

## Gotchas

- Install the plugin before spawning threads: threads older than the
  install are backfilled in the background, not at once.
- The chip is absent until a turn has finished; `spawn` returns only once
  the first turn is idle.
- Without `billingClaudeCode api-key` the fake API's key reads as billing
  `unknown` and the headline leads with tokens, not dollars.
- With `refreshPrices` on, the plugin fetches prices from the network at
  start; off, it uses its bundled list.
- The hover card opens after 250 ms and stays shut after a click: open the
  tab by clicking the chip.
- `thread-usage show` and the `refresh` RPC catch up on bb's events before
  answering, so they are the read-back to trust over a UI that updates on a
  400 ms debounce.
- The page's nav entry is `Thread usage`; `Usage` is a different plugin.
