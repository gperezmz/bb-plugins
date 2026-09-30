# Thread Glance

Replaces bb's sidebar thread list. Each row shows the thread's state glyph,
title (bold while unread), harness logo where it differs from its parent's,
machine where it is not the primary one, and time since it finished. Child
threads fold behind a count chip on their parent. The list header counts the
trees only you can move forward as `N need you`, and a tree quiet for longer
than Settle after moves into a `Settled (N)` fold at the end of its group.
Its server preferences are kept on the bb server and change in every open
window at once; Density and Branch line are kept per browser.

## Sub-features

- `list`: the list header (`Projects`, `Sections` or `Machines`) and one row
  per top-level thread.
- `children`: the chip that shows and folds a parent's child threads.
- `need-you`: the `N need you` filter and `Mark all read`.
- `settings`: the settings popover's radiogroups, checkboxes and sort order.
- `prefs-cli`: `bb thread-glance prefs list|get|set|reset`, live in an open
  popover.
- `settled`: the `Settled (N)` fold.
- `sync`: a change in one window reaching a second with no reload, and
  surviving a reload.
- `remount`: switching the sidebar thread list away from Thread Glance and
  back.

## How to get to it (user POV)

- The sidebar, once Thread Glance is the thread list: automatic on a bb with
  no other list plugin, or Settings → Appearance → `button "Sidebar thread
  list"` → `menuitem` starting `Thread Glance`, or
  `bb settings ui set sidebar.threadListProvider thread-glance/thread-glance`.
- List header: `heading` level 2, `button "Thread Glance settings"`,
  `button "Mark all read"` while something is unread, and a button with text
  `N need you` while N > 0 (`aria-pressed` when filtering).
- Rows: `link` named `Open <title> — <State>; <Provider>[; child of
  <parent>][; unread]…`, e.g. `Open parent — Idle; Claude Code`;
  `aria-current="page"` on the open one.
- Children chip: `button` named `Show N child thread(s) of <title>` (then
  `Collapse …`), with `, working below`, `, failed below`, `, waiting on you
  below`, `, unread below` and the like appended.
- Settled fold: `button` named `Show N settled thread tree(s)` (then `Hide
  …`), its text `Settled (N)`.
- Settings popover: radiogroups `Group by` (Project, Custom, Machine), `Sort
  by` (Updated, Created, A–Z), `Settle after` (12h, 1d, 3d, 1w, Never),
  `Density` (Compact, Comfortable), `Harness icon` (Muted, Colour); button
  `Sort order: <order>. Reverse`; checkboxes `Worktrees as folders`, `Branch
  line`, `Needs attention counts every child`, each named with its
  description after the label.
- CLI: `bb thread-glance prefs list [--json]`, `get <key>`, `set <key>
  <value>`, `reset <key>`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start thread-glance`. Threads come from
`drive-bb-plugins spawn`.

Every UI step is a verb, `drive-bb-plugins thread-glance --run <run> <verb>`,
which prints JSON: `before` and `after` the action, `stored` (what bb or the
browser kept), `secondWindow` with `--second-window` (a window opened before
the action, `followed` true when it changed with no reload) and `reloaded`
with `--reload` (`kept` true when a reload changed nothing). The command with
no verb lists them. Evidence lands in `ui/thread-glance.<verb>[-N]/`.

- **It is the list** (`list`): `thread-glance list` on a fresh run prints
  `heading` `Sections` (the first run imports bb's own grouping) and `empty`
  true; `drive-bb-plugins bb thread-glance.list/cli -- settings ui get sidebar.threadListProvider`
  prints `"__automatic__"`. `list --wait <title>` waits for a row, `list
  --open <title>` opens a row on screen (a child only under an open chip).
- **A tree in every state**:
  `P=$(drive-bb-plugins spawn thread-glance.children/spawn parent hi)`, then
  under it `spawn … child hi "$P"` and `spawn … busy hi "$P" --hold 60`
  (`Working` for 60 s): `list` shows `Show 2 child threads of parent, working
  below`. Then `spawn … broken hi "$P" --fail` (`Failed`) turns it to `Show 3
  child threads of parent, failed below`, since the chip names its
  highest-ranked state. Beside it, `spawn … deployer "Start the deploy."
  --background` shows `Background command running` until
  `drive-bb-plugins release <id>`; `needYou.count` is then 2.
- **Children** (`children`): `thread-glance children parent expand
  --second-window --reload` turns the chip to `Collapse …`, lists every child
  under `after.children`, `stored.holdsParent` true (`prefs get
  expandedChildren` holds `$P`), and both `secondWindow.followed` and
  `reloaded.kept` true.
- **Need you** (`need-you`): with a failed root beside a read tree
  (`mark-all-read` once every `--hold` turn has ended, since a turn ending
  makes its tree unread again, then `spawn … loud hi --fail`),
  `thread-glance need-you on` leaves only `loud` in `after.rows`, with
  `needYou.pressed` true. With
  `--second-window --reload`, `followed` and `kept` are false: the filter is
  per window and off on every load.
- **Mark all read** (`need-you`): `thread-glance mark-all-read` turns every
  row's `unread` false and drops `markAllRead`; `stored` has each thread
  `read` true in bb.
- **Settings** (`settings`): `thread-glance settings` prints every control,
  `prefs list --json` and the browser's `bb.thread-glance.client.v1`.
- **One control** (`settings`, `sync`): `thread-glance set "Settle after" 12h
  --second-window --reload` checks `12h`, `stored.value` `"12h"`, and
  `followed`, `kept` true. `set Density Comfortable --second-window` stores
  `density` in the browser and the second window does not follow; `set
  "Branch line" on`, `set "Needs attention counts every child" on` (stores
  `childAttention` `"everything"`), `set "Group by" Machine` and `set "Sort
  order" reverse` work the same way.
- **From the CLI, live** (`prefs-cli`): `thread-glance prefs-live settleAfter
  never` runs `prefs set` with the popover open and waits for `radio "Never"`
  checked with no reload.
- **Settled** (`settled`): `drive-bb-plugins bb thread-glance.settled/setup
  -- thread-glance prefs set settleAfter 12h`, read every thread
  (`mark-all-read`), then `thread-glance settled expand --advance 13` moves the
  page's clock 13 hours on and opens the fold: `before.text` `Settled (N)`,
  `stored.openSettledFolds` holds the group (`threads` under Custom).
- **Remount** (`remount`): `thread-glance remount` picks `Thread list
  (built-in)` in Settings → Appearance, sees Thread Glance gone (`away`), picks
  `Thread Glance` again, and prints the rows and chips before and after;
  `--via automatic` returns through `Automatic`. Server preferences, open
  chips included, survive; the need-you filter does not.
- **Machine offline**: `drive-bb-plugins machine offline` under a `--hold`
  turn shows `Reconnecting` for bb's 30 s grace, then `Failed`; a `bb thread
  tell` while offline shows `Message waiting to send`. `machine online`
  brings the machine back and sends it, and doctor passes again.

A step no verb covers is added to `verbs/thread-glance.mjs` in the same pull
request as the drive that needed it, as [the README](README.md#driving-conventions)
says.

## Gotchas

- The thread on screen, and any thread in a split pane, is never unread, so
  unread, `need you` and `Mark all read` show only for other threads. Mark
  all read asks for confirmation above 20 threads; the verb confirms.
- Read state set elsewhere (`bb thread read`) reaches an open window only on
  reload in bb 0.44, bb's own list included; a child marked read reaches it
  live. Thread Glance's Mark all read and Mark read send bb's
  `threads.markRead`: a second window follows them live, but bb's own list in
  the window that sent them keeps those threads unread until a reload. Read
  it back with `list` on a fresh load, not a second window.
- A turn in flight when its machine goes offline fails once bb's 30 s
  reconnect grace ends, so the `Machine offline` state and the chip's
  `, machine offline below` are not reachable on a run.
- Settle after is at least 12 hours, and settling reads bb's thread times, so
  only the page clock (`settled --advance`) reaches the fold.
- The settings popover closes itself when opened in the first half-second
  after load; the verbs wait for the page to go quiet and reopen it.
- Density and Branch line live in the browser's `localStorage`
  (`bb.thread-glance.client.v1`); the need-you filter lives only in the page.
  The CLI reads neither.
- Popover writes reach the server after a 150 ms debounce; `set` polls `prefs
  get` for up to 10 seconds.
- Times in rows are relative and tick; assert on names, not times.
