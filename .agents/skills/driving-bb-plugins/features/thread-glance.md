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
- `window`: the list mounts only the rows near the sidebar's view, each run
  of the rest a spacer bb's keyboard walk still reads.
- `menus`: the list's one row menu, group menu, context menu and hover card.
- `drag`: dragging rows and group headers with the pointer, and bb's
  drag-to-split out of the sidebar.
- `keys`: Enter on a row, the context-menu key, and bb's thread shortcuts.

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
- **Every row** (`list`): `thread-glance rows` scrolls the windowed list top
  to bottom and prints each row's name, drawn text (title, note line, time)
  and time label; `--details` hovers each row and adds its hover card (state
  and since, note, `Last reply`, `Finished`), `--requests` the load's fetches
  grouped by calling script (Thread Glance's bundle is a
  `plugin-app-assets/<hash>/app.js`) with `threadGlance.calls` naming each
  RPC and its body, `--first-draw` the list at each of its first DOM changes
  (`firstDraw[]`, with `settled` folds), `--advance <h>` the page's clock
  that many hours ahead from the load on. `--warm` loads once and measures a
  reload (a browser holding its preferences mirror); `--delay-sync <ms>`,
  `--delay-branches <ms>` and `--delay-ws <ms>` hold `sync` answers, bb's
  project and branch lookups, or the realtime socket, and `held[]` says how
  many list states were drawn before each was let through; `--idle <s>`
  counts the requests of that many idle seconds after the load. Two `rows`
  results compare row by row once relative times are masked.
- **Leaving for Settings** (`remount`, `sync`): `thread-glance away` loads,
  leaves by bb's sidebar `Settings` link (no reload: `trips[].sameRealm`
  true), runs `--actions <json file>` while the sidebar is unmounted (each a
  `bb` argument array, `{"sleep": ms}` or `{"harness": [...]}`), comes back by
  history back, and prints `trips[].firstDraw` (the list as first drawn),
  `trips[].requestsOnReturn` (fetches by calling script, `threadGlance.rpc`)
  and `after` (the list once quiet); `--times <n>` makes n trips,
  `--details <title,title>` adds those rows' hover cards, `--branch-line`
  turns Branch line on first, `--settings` reads the popover's controls once
  back. Unlike `remount`, which reloads the page, this
  keeps the plugin's app loaded, as a user's trip to Settings does.
- **Realtime reconnect** (`sync`): `thread-glance reconnect --actions <file>`
  closes the page's realtime socket (`/ws`) and refuses it back while the
  actions run, then lets it back and prints `during` (the list while down),
  `after` (once reconnected, `sameRealm` true) and `requestsAfterReconnect`.
- **Two windows, live** (`sync`): `thread-glance live --actions <file>
  --until <regex> --second-window` runs the actions and waits, with no reload,
  until a row's name matches the regex in every window
  (`windows[].untilReachedMsAfterActions`), then prints each window's rows;
  `--frames` adds each realtime frame naming thread-glance from the actions
  on (a `records` signal per thread event). The actions block the verb while
  they run, so frames and the wait are timed from their end.
- **First-run import** (`settings`): `thread-glance import-once --actions
  <file>` counts `importPreferences` on one browser profile through a first
  load, a reload, a trip to Settings, the actions (such as `plugin reload
  thread-glance`) and a reload after them; `--fail-first` aborts the first
  import in the network, so the device has no answer yet.
- **Window** (`window`): `thread-glance scroll` scrolls the sidebar top to
  bottom and back; every step has `outside` and `missing` 0 (the first nine
  rows, which bb's jump keys reach, stay mounted and count as neither), and
  `walkAlwaysSame` is true: bb's next and previous walk reads the same
  threads, in order, however far it scrolled. `--step <px>` sets the step.
- **Menus** (`menus`): `thread-glance menu <title>` opens the row's "…" and
  lists its items, then closes it with Escape; `focusAfterEscape` is the "…"
  button. `--keyboard` opens it with Enter, `--context` by right-click and
  `--keyboard-context` by Shift+F10 on the focused row, where focus goes back
  to the row's link; `menu --group <label>` opens a group header's. A row the
  sidebar has scrolled out of view is scrolled into it first.
- **Drag** (`drag`): `thread-glance drag <title> --onto <title> [--zone
  top|middle|bottom]` drops a row on another's zone, `--onto-group <label>` on
  a group header, waiting at the sidebar's edge while it scrolls to a target
  out of view; `feedback` is what was drawn while over it (`nest` `valid`,
  `blocked` or `unchanged`, `placement` `before` or `after` in Pinned, or the
  highlighted `header`), `after` the thread's parent, section and pin in bb.
  Under Custom grouping (a fresh run's), `--onto-group` a section moves the
  thread there; `--onto-group Pinned` pins it (`bb thread pin` one thread
  first, for Pinned to show); a child dropped on its group's header leaves
  its parent; a parent dropped on its own child shows `blocked` and changes
  nothing. `thread-glance drag-group <label> --onto <label>` reorders groups
  and reads the saved order back.
- **Splits** (`drag`): `thread-glance split <title> --from <title>` opens
  `--from`'s thread and drags the row onto the main area's right edge;
  `--ctrl-click` Ctrl+clicks it instead. `composers` 2 is two panes, and
  `rowsWithMiniMap` names both rows.
- **Keys** (`keys`): `thread-glance enter <title>` focuses the row's link and
  presses Enter, which opens the thread (`current` is its title).
  `thread-glance key-drag <title>` (or `--group <label>`) presses Space,
  arrows and Enter on the focused row or header: `dragStarted` and `changed`
  are false, since no key starts a drag, and `ariaDisabled` is empty.
  `thread-glance shortcut <n> [--scroll <px>]` presses bb's web jump key,
  Control+Shift+n, and `thread-glance shortcut next|previous --from <title>`
  Control+Shift+] or [ from that thread's; `same` is true when bb opened the
  thread its keyboard walk puts there.
- **Phone** (`--mobile`): every verb first opens the sidebar's drawer, which
  a phone keeps closed under the main area. `thread-glance long-press
  <title>` opens the row's menu as a drawer after 700 ms, and lifting chooses
  nothing (`openAfterLift` true, `navigated` and `detailsOpened` false);
  `--move 24` cancels it (`items` null): Chromium delivers no `touchmove`
  inside its touch slop, about 15 px, so a smaller move drives nothing. `thread-glance menu <title>` opens it
  from the screen reader's "…" with Enter. `thread-glance drawer` opens a
  thread, which closes the drawer, and reports the rows mounted closed and
  open again.
  `thread-glance mark-all-read-home --mobile` reads the home screen's
  `Recent` list around Mark all read: `recentUnreadAfter` and
  `recentUnreadAfter6s` name the threads bb's own list still shows unread
  with no reload, `recentUnreadAfterReload` after one.
- **Archived** (`list`): with `prefs set showArchived true`, each group
  also lists archived threads, 50 at a time behind `button "Load more
  archived threads"`; any verb with `--all-archived` presses it until it is
  gone on each load, so every archived thread is drawn.
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
- Read state set elsewhere (another window's Mark all read, `bb thread read`)
  reaches an open window only on reload in bb 0.44, bb's own list included;
  a child marked read reaches it live. Read it back with `list` on a fresh
  load, not a second window.
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
- The list is windowed: only rows near the viewport are in the DOM, so read
  every row with `rows`, not `list`, and a hover card only while its row is
  drawn.
- Each verb run is a new browser profile, so a first load in any verb is a
  device that never got an import answer; `import-once` keeps one profile.
- bb 0.44's `thread unarchive` unarchives one thread and always sends
  `thread.unarchived`; archiving a parent archives its children, unarchiving
  it does not bring them back.
- The Branch line shows only for a thread off its project's default branch.
- A verb that acts on one row scrolls it into view first (`reveal` in the
  verbs file).
- A phone's home screen lists threads under the same `Open <title> — …`
  names as the list's rows; the verbs' `row` matches only the list's own.
