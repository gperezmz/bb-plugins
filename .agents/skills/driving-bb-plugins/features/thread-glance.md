# Thread Glance

Replaces bb's sidebar thread list. Each row shows the thread's state glyph,
title (bold while unread), harness logo where it differs from bb's default
provider (a child's: from its parent's), machine where it is not the primary
one and the list is not grouped by machine, and time since it finished. Child
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
- `menus`: bb's own thread menu on a row ("…" and context menu) with the
  list's items added, and the list's own group menu, environment row menu and
  hover card.
- `groups`: a group header's New thread, Rename and Remove project or Remove
  section.
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
- Group headers, each a `region` named for its group:
  `button "Collapse|Expand <label> section"` (double-click renames a project,
  section or machine), `button "New thread in <label>"` (on a phone, only on
  the group holding the open thread) and `button "<label> actions"`.
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
- CLI: `bb thread-glance prefs list|get <key>|set <key> <value>|reset <key>`,
  each taking `--json`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start thread-glance`. Threads come from
`drive-bb-plugins seed` with a shape file (the skill's
[Seeding](../SKILL.md#seeding)); only a thread working, failed or running a
background command takes `drive-bb-plugins spawn` and its flag. A recipe
over a long list (`rows`, `scroll`, archived, `away`, `live`) starts from
`start --snapshot user-800 thread-glance`, the user's 802 threads with 104
live, saved once per bb version from
[`shapes/user-800.json`](../shapes/user-800.json) with `seed` and `save`
where `snapshots` does not list it.

Every UI step is a verb, `drive-bb-plugins thread-glance --run <run> <verb>`,
which prints JSON: `before` and `after` the action, `stored` (what bb or the
browser kept), `secondWindow` with `--second-window` (a window opened before
the action, `followed` true when it changed with no reload) and `reloaded`
with `--reload` (`kept` true when a reload changed nothing). The command with
no verb lists them. Evidence lands in `ui/thread-glance.<verb>[-N]/`.

- **It is the list** (`list`): `thread-glance list` on a fresh run prints
  `heading` `Projects` (Thread Glance's default grouping; it reads none of bb's
  list's) and `empty` true; `drive-bb-plugins bb thread-glance.list/cli -- settings ui get sidebar.threadListProvider`
  prints `"__automatic__"`. `list --wait <title>` waits for a row, `list
  --open <title>` opens a row on screen (a child only under an open chip).
- **A tree in every state**: `seed` a shape of
  `{"trees": [{"count": 1, "children": 1, "title": "parent"}]}`, which makes
  `parent 1` and its child `parent 1.1`; `P` is `parent 1`'s id, `jq -r
  '.quiet.trees[0].id'` of `seed.json` in the evidence. Under it `spawn
  thread-glance.children/spawn busy hi "$P" --hold 60` (`Working` for 60 s): `list` shows `Show 2 child threads of
  parent 1, working below`. Then `spawn … broken hi "$P" --fail` (`Failed`)
  turns it to `Show 3 child threads of parent 1, failed below`, since the chip
  names its highest-ranked state; `parent 1` stays `pending` and runs no
  turn. Beside it, `spawn … deployer "Start the deploy." --background` shows
  `Background command running` until `drive-bb-plugins release <id>`;
  once `busy`'s turn has ended, `needYou.count` is 2: `parent 1`'s tree, for
  its failed child, and `deployer`. `busy` finished unread adds nothing, since
  by default only a child that failed or waits on you counts.
- **Children** (`children`): `thread-glance children "parent 1" expand
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
  `read` true in bb. Above 20 unread threads (`seed` `{"states": {"unread":
  21}}`) it confirms first: `confirm.title` is `Mark 21 threads read?`, and
  `confirm.whileClosing` holds that same title alone, since the dialog keeps
  its text while it animates out.
- **Settings** (`settings`): `thread-glance settings` prints every control,
  `prefs list --json` and the browser's `bb.thread-glance.client.v1`.
- **The popover itself** (`settings`): `thread-glance popover`, on a list
  long enough to scroll (`seed` 80 roots, or the `user-800` snapshot). Opened
  as soon as the list header shows on a load, `afterLoad.openAfter2s` is true,
  though bb focuses its composer for about a second after a load. `halfOut.open`
  is true (half of `button "Thread Glance settings"` scrolled away) and
  `out.open` false (all of it). With half the button in view, `closers`
  `Escape`, `button` and `outside` each close it with `scrollBefore` equal to
  `scrollAfter`; Escape and the button leave `focusOnButton` true, a click
  outside false. `closers.Tab.closed` is false: Tab cycles focus inside the
  popover. With `--mobile` the settings open as a drawer, which `out.open`
  shows staying open while the sidebar scrolls.
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
  `stored.openSettledFolds` holds the group, `project:<id>` of the run's
  `drives` project (`threads` for the loose group under Custom).
- **Remount** (`remount`): `thread-glance remount` picks `Thread list
  (built-in)` in Settings → Appearance, sees Thread Glance gone (`away`), picks
  `Thread Glance` again, and prints the rows and chips before and after;
  `--via automatic` returns through `Automatic`. Server preferences, open
  chips included, survive; the need-you filter does not.
- **Every row** (`list`): `thread-glance rows` scrolls the windowed list top
  to bottom and prints each row's name, drawn text (title, note line, time)
  and time label; `--details` hovers each row and adds its hover card (state
  and since, note, `Harness`, `Model`, `Branch`, `Machine`, `Children`,
  `Pull request`, `Last reply` where there is no note, `Created`, `Finished`,
  each where it applies, as `card[]`), `--requests` the load's fetches
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
  leaves by bb's `Settings` in its navigation rail (no reload: `trips[].sameRealm`
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
  on (a `records` signal when a turn or read state changes a thread; a
  `thread update --title` sends none). The actions block the verb while
  they run, so frames and the wait are timed from their end.
- **Window** (`window`): `thread-glance scroll` scrolls the sidebar top to
  bottom and back; every step has `outside` and `missing` 0 (the first nine
  rows, which bb's jump keys reach, stay mounted and count as neither), and
  `walkAlwaysSame` is true: bb's next and previous walk reads the same
  threads, in order, however far it scrolled. `--step <px>` sets the step.
- **Menus** (`menus`): `thread-glance menu <title>` opens the row's "…" and
  lists its items, then closes it with Escape; `focusAfterEscape` is the "…"
  button. `--keyboard` opens it with Enter, `--context` by right-click and
  `--keyboard-context` by Shift+F10 on the focused row, where focus goes back
  to the row's link. A row's items are bb's thread menu with the list's
  `Details`, `Copy thread ID`, `Move…` (not on an archived thread) and
  `Mark tree read` (on a root with an unread child) among them.
  `menu --group <label>` opens a group header's: `Mark all read` while one is
  unread, `New thread`, `New section` (Custom), `Rename` (a project, section
  or machine), `Hide from list` (not Pinned), `Show archived threads`,
  `Customize list`, and `Remove project` on a project or `Remove section` on a
  section. A row the sidebar has scrolled out of view is scrolled into it
  first.
- **New thread in a group** (`groups`): `thread-glance new-thread <label>`
  presses the header's `button "New thread in <label>"` (`--menu`: the group
  menu's `New thread`), sends a prompt from bb's compose screen and prints
  `composeProject` (the compose screen's `Project:` button, its only sign of
  the group) and the new `thread`'s `projectId`, `sectionId`, `pinned` and
  `hostId`: from Pinned `pinned` true, from a section its `sectionId`, from a
  project its `projectId`, from a machine its `hostId`; Pinned, a section and
  Threads start in `proj_personal` (`No project`). The verb waits out the turn
  and releases its runtime. An empty list draws no group to press.
- **Rename and remove a group** (`groups`):
  `thread-glance group <label> rename <name>` (`--dblclick`: double-click the
  header instead of the menu's `Rename`) prints `boxName`, `Project name`,
  `Section name` or `Machine name`, the headers `before` and `after`, and
  `stored`, bb's project, section and machine names. `group <label> remove`
  picks `Remove project` or `Remove section` and confirms: `dialog.title`
  `Remove <label>?` with
  `The project and its threads are removed from bb. This cannot be undone.`
  and buttons `Cancel`, `Remove project`, or `Remove section?` with
  `Threads in this section will move back to Threads.` and `Cancel`, `Remove`;
  `--cancel` leaves the group. Remove only a project made for it:
  `drive-bb-plugins bb … project create --name spare --root <git repository> --machine <host>`,
  the run's `host_id` and `scratch` in `run.env` giving a host and a place for
  the repository.
- **Drag** (`drag`): `thread-glance drag <title> --onto <title> [--zone
  top|middle|bottom]` drops a row on another's zone, `--onto-group <label>` on
  a group header, waiting at the sidebar's edge while it scrolls to a target
  out of view; `feedback` is what was drawn while over it (`nest` `valid`,
  `blocked` or `unchanged`, `placement` `before` or `after` in Pinned, or the
  highlighted `header`), `after` the thread's parent, section and pin in bb.
  Under Custom grouping (`prefs set organizationMode chronological`; a fresh run starts under Projects), `--onto-group` a section moves the
  thread there; `--onto-group Pinned` pins it (`bb thread pin` one thread
  first, for Pinned to show); a child dropped on its group's header leaves
  its parent; a parent dropped on its own child shows `blocked` and changes
  nothing. `thread-glance drag-group <label> --onto <label>` drops the header
  on the upper half of `--onto`'s group, before it; `--zone bottom` on the
  lower half, after it. It reads the saved order back.
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
- **Phone** (`--mobile`): every verb first opens the sidebar's drawer, which a
  phone keeps closed under the main area. `thread-glance long-press <title>`
  presses the row for 800 ms, which opens bb's thread menu as a drawer, and
  lifting chooses nothing (`openAfterLift` true, `navigated` and
  `detailsOpened` false); `--move 24` cancels it (`items` null): bb's press
  cancels when the finger moves, but Chromium delivers no `touchmove` inside
  its touch slop, about 15 px, so a smaller move drives nothing.
  `thread-glance menu <title>` opens it from the screen reader's "…" with
  Enter. `thread-glance drawer` opens a thread, which closes the drawer, and
  reports the rows mounted closed and open again.
  `thread-glance mark-all-read-home --mobile` reads the home screen's `Recent`
  list around Mark all read: `recentUnreadAfter` and `recentUnreadAfter6s`
  name the threads bb's own list still shows unread with no reload,
  `recentUnreadAfterReload` after one.
- **Environment fold row** (`list`, `menus`): `spawn … wt-one hi
  --worktree` gives a thread a git worktree of its own, and `spawn … wt-two
  hi --beside <wt-one's id>` puts a second in it; `seed` makes no worktree
  thread. With `prefs set environmentGrouping true`, `thread-glance
  fold-row` finds the row whose `button` is named `Collapse <branch>
  environment, 2 threads` and prints its `height` beside `threadRowHeights`
  (the one-line row is the smallest): 28 px, and 32 px with `--density
  comfortable`; with `--mobile`, 36 and 40 px. `menu` is its
  `Environment actions` menu: `New thread in environment`, `Rename`,
  `Archive`.
- **Archived** (`list`): with `prefs set showArchived true`, each group
  also lists archived threads, 50 at a time behind `button "Load more
  archived threads"`; any verb with `--all-archived` presses it until it is
  gone on each load, so every archived thread is drawn.
- **Machine offline** (`list`, `children`): `drive-bb-plugins machine offline`
  under a `--hold` turn shows `Working`, then, 15 to 30 s on,
  `Machine offline` for as long as the machine is away; a lone such child
  turns its parent's chip to `…, machine offline below` (a failed sibling
  outranks it). A `bb thread tell` while offline to a thread that has not
  failed shows `Message waiting to send` (a failed one stays `Failed`).
  `machine online` brings the machine back, the held turn ends `Failed` and
  the waiting message is sent, and doctor passes again.

A step no verb covers is added to `verbs/thread-glance.mjs` in the same pull
request as the drive that needed it, as [the README](README.md#driving-conventions)
says.

## Gotchas

- The thread on screen, and any thread in a split pane, is never unread, so
  unread, `need you` and `Mark all read` show only for other threads. Mark
  all read asks for confirmation above 20 threads; the verb confirms.
- Read state set elsewhere (another window's Mark all read, `bb thread read`,
  opening the thread in another window) reaches an open window only on
  reload, bb's own list included, child threads too: bb 0.46 sends
  `read-state-changed` but only marks its sidebar threads query stale
  (`refetchType: "none"`), so `experimental_useSidebarThreads` hands the list
  nothing new until something else refetches it. Read it back with `list` on
  a fresh load, not a second window.
- A tree that settles while it holds the open thread stays out of the fold
  until focus leaves it; a fresh load folds it at once, as `settled` does.
- Settle after is at least 12 hours, and settling reads bb's thread times, so
  only the page clock (`settled --advance`) reaches the fold.
- On a desktop the settings popover closes once the sidebar scrolls its
  button out of view, so a step that scrolls the list closes it; a phone's
  settings drawer stays open.
- Density and Branch line live in the browser's `localStorage`
  (`bb.thread-glance.client.v1`); the need-you filter lives only in the page.
  The CLI reads neither.
- Popover writes reach the server after a 150 ms debounce; `set` polls `prefs
  get` for up to 10 seconds.
- Times in rows are relative and tick; assert on names, not times.
- The list is windowed: only rows near the viewport are in the DOM, so read
  every row with `rows`, not `list`, and a hover card only while its row is
  drawn.
- Each verb run is a new browser profile.
- bb 0.44's `thread unarchive` unarchives one thread and always sends
  `thread.unarchived`; archiving a parent archives its children, unarchiving
  it does not bring them back.
- The Branch line shows only for a thread off its project's default branch.
- `bb thread unread` on a quiet thread leaves it drawn read `Idle`, and Mark
  all read neither counts nor marks it; unread threads for a drive come from
  `seed`'s `unread` state.
- A verb that acts on one row scrolls it into view first (`reveal` in the
  verbs file).
- A phone's home screen lists threads under the same `Open <title> — …`
  names as the list's rows; the verbs' `row` matches only the list's own.
