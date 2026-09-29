# Thread Glance

Replaces bb's sidebar thread list. Each row shows the thread's state glyph,
title (bold while unread), harness logo where it is not bb's default,
machine, and time since it finished. Child threads fold behind a count chip
on their parent. The list header counts the trees only you can move forward
as `N need you`, and a tree quiet for longer than Settle after moves into a
`Settled (N)` fold at the end of its group. Its preferences are kept on the
bb server and change in every open window at once.

## Sub-features

- `list`: the list header (`Sections`, `Projects` or `Machines`) and one row
  per top-level thread.
- `children`: the chip that shows and folds a parent's child threads.
- `need-you`: the `N need you` filter and `Mark all read`.
- `settings`: the settings popover's radiogroups and checkboxes.
- `prefs-cli`: `bb thread-glance prefs list|get|set|reset`.
- `settled`: the `Settled (N)` fold.

## How to get to it (user POV)

- The sidebar, once Thread Glance is the thread list: automatic on a bb with
  no other list plugin, or Settings → Appearance → Sidebar → Thread Glance,
  or `bb settings ui set sidebar.threadListProvider thread-glance/thread-glance`.
- List header: `heading` level 2, `button "Thread Glance settings"`,
  `button "Mark all read"` while something is unread, and a button with text
  `N need you` while N > 0 (`aria-pressed` when filtering).
- Rows: `link` named `Open <title> — <State>; <Provider>`, e.g. `Open parent
  — Idle; Claude Code`; `aria-current="page"` on the open one.
- Children chip: `button` named `Show N child thread(s) of <title>` (then
  `Collapse …`), with `, working below` and the like appended.
- Settings popover: radiogroups `Group by` (Project, Custom, Machine), `Sort
  by` (Updated, Created, A–Z), `Settle after` (12h, 1d, 3d, 1w, Never),
  `Density` (Compact, Comfortable), `Harness icon` (Muted, Colour); checkboxes
  `Worktrees as folders`, `Branch line`, `Needs attention counts every child`.
- CLI: `bb thread-glance prefs list [--json]`, `get <key>`, `set <key>
  <value>`, `reset <key>`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start thread-glance`. Threads come from
`drive-bb-plugins spawn`.

- **It is the list** (`thread-glance.list/sidebar`): a `ui` script at `url`
  finds `heading "Sections"` and `button "Thread Glance settings"`, and
  `paragraph "No threads yet."` on a fresh run.
  `drive-bb-plugins bb thread-glance.list/cli -- settings ui get sidebar.threadListProvider`
  prints `"__automatic__"`.
- **Settle after from the popover** (`thread-glance.settings/popover`):
  `prefs get settleAfter` prints `"1d"`; a `ui` script clicks
  `button "Thread Glance settings"`, then `radio "12h"` in `radiogroup
  "Settle after"`, waits for it checked, captures; within a few seconds
  `drive-bb-plugins bb thread-glance.settings/cli -- thread-glance prefs get settleAfter`
  prints `"12h"`.
- **From the CLI, live** (`thread-glance.prefs-cli/cli`): with the popover
  open, `thread-glance prefs set settleAfter never` checks `radio "Never"`
  with no reload.
- **Children** (`thread-glance.children/sidebar`):
  `P=$(drive-bb-plugins spawn thread-glance.children/spawn parent hi)`, then
  `drive-bb-plugins spawn thread-glance.children/spawn child hi "$P"`; a `ui`
  script at `url` finds `link` named `Open parent — …` and `button` named
  `Show 1 child thread of parent…`; clicking it shows a row titled `Child of
  parent` and renames the button `Collapse 1 child thread of parent…`;
  `thread-glance prefs get expandedChildren` contains `$P`.

## Gotchas

- The thread on screen is never unread, so unread, `need you` and `Mark all
  read` show only for threads other than the open one.
- `Settled` needs at least 12 hours of quiet and Thread Glance has no drive
  clock: drive the `settleAfter` preference, not the fold.
- Density, Branch line and the need-you filter live in the browser's
  `localStorage` (`bb.thread-glance.client.v1`), so the CLI cannot read them
  back; read them with `page.evaluate`.
- Preference writes from the popover reach the server after a short
  debounce: poll `prefs get` for a few seconds rather than reading once.
- Times in rows are relative and tick; assert on names, not times.
