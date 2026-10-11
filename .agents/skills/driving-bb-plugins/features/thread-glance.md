# Thread Glance

Replaces bb's sidebar thread list. A project scope picker sits over shelves:
Pinned and Active above, then Working (a setting), Inactive, Snoozed, Parked
and Settled. A thread sits on one shelf, drawn as a full card (three lines), a
folded card (one line, Working) or a slim row (Snoozed, Parked, Settled), and
a parent's child threads fold behind a chip. Snooze, Park and Settle move a
thread between shelves from hover buttons and bb's thread menu. A plug icon
on a card shows that something listens in the thread's workspace; its hover
card lists those ports with Stop, a settle offers to close the ports the
thread owns, and the Settled shelf's Clean closes the terminals and owned
ports of settled threads. Settings are one record on the bb server, edited on
a settings page and followed by every window; shelf, sort and chip state, and
the port link machine, stay in the browser.

## Sub-features

- `list`: the scope picker, shelf headers and one card per top-level thread.
- `cards`: the full, folded and slim rows, their status slot, port indicator
  and buttons.
- `children`: the chip that opens a parent's child list.
- `shelf`: opening and collapsing a shelf; Active's sort.
- `scope`: limiting every shelf to one project.
- `hover`: the hover card on a row.
- `actions`: Snooze (presets), Park, Resume, Wake, Settle, Un-settle, Pin and
  Unpin, from hover buttons, slim-row buttons and the thread menu.
- `menu`: bb's thread menu on a row with the list's items added.
- `reorder`: moving a row with Alt+Arrow or the pointer.
- `ports`: the port indicator, "Workspace ports (N)" and Stop.
- `port-link`: the port link machine on the settings page.
- `settle-prompt`: "Close this thread's ports?" after a manual settle.
- `clean`: the Clean button and "Clean settled resources?" dialog.
- `settings`: the settings page and its autosave.
- `window`: the list mounts only the rows near the view.
- `remount`: switching the sidebar list away from Thread Glance and back.
- `phone`: a long press and the sidebar drawer on a phone.
- `keys`: Enter on a row and bb's thread shortcuts.

## How to get to it (user POV)

- The sidebar, once Thread Glance is the thread list: automatic on a bb with no
  other list plugin, or Settings → Appearance → `button "Sidebar thread list"`
  → `menuitem` starting `Thread Glance`, or
  `bb settings ui set sidebar.threadListProvider thread-glance/thread-glance`.
- Scope: `button "Project scope: <All projects|project>"`, which opens a
  `combobox "Filter projects"` over `listbox "Projects"` of `option`s.
- Shelf headers: `button` named `Pinned`, `Active`, `Working`, `Inactive`,
  `Snoozed`, `Parked` or `Settled` with `aria-expanded`, named `Name (N)` while
  collapsed. Pinned, Active and Working start open, the rest collapsed. A shelf
  with no threads is not drawn. Active's header holds `combobox "Sort Active"`
  (Manual order, Recent activity, Date created, Project); Settled's holds
  `button "Close terminals and ports of settled threads"` (text `Clean`), shown
  collapsed too.
- Rows: `link` named for the thread's title, one `link` per card; a card has
  `button "Snooze <title>"` and `button "Settle <title>"` (full and folded
  cards, not busy or woke), `button "Thread actions for <title>"`, and
  `button "Unpin <title>"` on a pinned one. A slim row's restore button is
  `button "Resume thread"` (Parked), `"Wake thread now"` (Snoozed) or
  `"Un-settle thread"` (Settled). Status slot text: `Needs you`, `Failed`,
  `Unread`, `Working`, else the age (`7m`).
- Children chip: `button` named `N child thread(s), 1 failed, 1 need you…`
  with `aria-expanded`; open, it lists the children under the card.
- Port indicator: `img "N workspace port(s)"` on a card's third line and on a
  folded card; none on a slim row.
- Hover card (pointer rests on a row 250 ms; keyboard focus opens it at once):
  lines `Project`, `Machine`, `Branch`, `Harness`, `Model`, `Reasoning`, a pull
  request when the branch has one, `Subthreads (N)`, and `Workspace ports (N)`
  with one entry per listener: `:port`, the executable name and
  `button "Stop <process> on port <port>"` (then
  `"Confirm stopping <process> on port <port>"`, text `Confirm stop`). An entry
  is a link to `http://127.0.0.1:<port>` (`https` for 443 and 8443) when the
  port link machine is its machine.
- Thread menu (`menu "Thread actions for <title>"`, from the `…` button or a
  right-click): `Open in split`, `Parent…`, `Project`, `Copy thread link`,
  `Copy branch`, `Copy thread ID`, `Mark unread`, `Pin`, `Snooze` (submenu of
  the presets and `Pick date & time…`), `Park thread`, `Settle`, `Rename`,
  `Notifications`, `Archive`, `Delete`; `Resume` on a parked thread, `Wake now`
  on a snoozed one, `Un-settle` on a settled one.
- Toasts: `Thread parked`, `Thread snoozed`, `Thread settled`,
  `Thread woke up`, `Thread returned to Active`, each with `Undo`; the ports
  prompt `Close this thread's ports?` with `Keep open` and `Close ports`;
  `Stop requested for :<port>`.
- Clean: `alertdialog "Clean settled resources?"`, per thread its title, its
  terminals and ports (`2 terminals · :18772 node`) and
  `button "Open <title>"`; buttons `Cancel`, `Clean resources` (`Cleaning...`),
  then the result line (`N terminals closed · M port shutdown requests sent`),
  `Close`; `Refresh preview` when the preview expired.
- Settings: `/settings/plugins/thread-glance` — `navigation "Settings groups"`
  (Sidebar layout, Project appearance, Thread behavior, Child threads, This
  device, Project management), `switch`es, `spinbutton`s
  (`Hours before inactive`, `Days before auto-settle`), `combobox`es
  (`Show stripes in`, `Order`, `Direction`, `Icon`, `Customize a project`, and
  `Port link machine` under This device) and `textbox "Snooze shortcuts"`. The
  page heading's `status` reads `Saving…` then `Saved`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start thread-glance`. Threads come from
`drive-bb-plugins seed` with a shape file (the skill's
[Seeding](../SKILL.md#seeding)); a thread that works, fails or runs a
background command, or has a worktree of its own, takes
`drive-bb-plugins spawn` and its flag. A recipe over a long list (`window`)
starts from `start --snapshot user-800 thread-glance`, saved once per bb
version from [`shapes/user-800.json`](../shapes/user-800.json) with `seed` and
`save` where `snapshots` does not list it.

Every UI step is a verb, `drive-bb-plugins thread-glance --run <run> <verb>`,
which prints JSON: `before` and `after` the action, `stored` (what the plugin
or the browser kept), `secondWindow` with `--second-window` (a window opened
before the action, `followed` true when it changed with no reload) and
`reloaded` with `--reload` (`kept` true when a reload changed nothing). The
command with no verb lists them. Every verb takes `--shelf <name>`, which
opens that shelf on each load so a row on a collapsed shelf is drawn. Evidence
lands in `ui/thread-glance.<verb>[-N]/`. Hover cards, Stop and the menus need
the pointer, so those verbs run on the desktop viewport.

- **It is the list** (`list`, `cards`): `thread-glance list` prints `scope`,
  `shelves` (`shelf`, `label`, `expanded`, `sort`), `rows` (`shelf`, `card`
  `full|folded|slim`, `status`, `bold`, `ports`, `chip`, `buttons`, `labels`,
  `text`, `children`), `groups`, `loadMore`, and `allClear` for the scene a
  scope with nothing to do shows (`scope Personal`). On a fresh run, after
  `seed` of
  `{"trees": [{"count": 3, "children": 1, "title": "alpha"}], "states": {"finished": 2, "failed": 1, "unread": 1}}`,
  every thread is on Active. `list --wait <title>` waits for a row,
  `list --open <title>` opens one. A row whose shelf is collapsed is not in
  `rows` until `--shelf` opens it.
- **Children** (`children`): `thread-glance children "alpha 1" expand --reload`
  turns the chip's `expanded` true, lists the child under `after.children`,
  `stored.expandedParents` holds the parent's id and `reloaded.kept` is true.
  `--second-window` ends `followed` false: the open parents are read when a
  window mounts.
- **Shelves** (`shelf`): `thread-glance shelf active collapse --reload` labels
  the header `Active (N)`, `stored.collapsedShelves` is `{"active": true}`,
  kept after a reload. `shelf settled expand` opens Settled.
- **Active sort** (`sort`): `thread-glance sort "Recent activity"` re-orders
  `after.order` and stores `activeSort` `activity`; `Project` adds a `groups`
  header (`Collapse drives group`) for a project with two Active threads;
  `Manual order` is the default.
- **Scope** (`scope`): `thread-glance scope drives` lists the picker's
  `options` and the rows left; `scope "All projects"` clears it; with no
  argument it only reads the options.
- **Hover card** (`hover`, `ports`): `thread-glance hover "finished 1"` rests
  the pointer on the row and prints `indicator` (the card's port indicator
  name) and `card.lines`, `card.portsHeading` and `card.ports[]` (`port`,
  `process`, `href`, `stop.name|text|armed`). A thread forked from a real turn
  reads `Model` `claude-opus-5-5[1m]`; a quiet thread `Not set`.
- **Giving a thread a listening port**: ports come from real processes on the
  run's machine (this one), and the fake API cannot run commands, so start one
  yourself, with a working directory inside the thread's workspace. Every
  `seed`ed or `spawn`ed thread of the `drives` project shares the project's
  checkout, `<scratch>/work/demo` (`scratch` in `.drives/<run>/run.env`), so
  one server shows on all of them:
  ```bash cd "$(. .drives/<run>/run.env; echo $scratch)/work/demo" && BB_THREAD_ID=<thread id> node -e 'require("http").createServer((q,r)=>r.end("ok")).listen(+process.argv[1],"127.0.0.1")' 18765 >/dev/null 2>&1 & echo $! ```
  With `BB_THREAD_ID` naming one thread of that workspace the port is that
  thread's **owned port**; without it, or naming another, it belongs to the
  workspace and shows with Stop but is never in the settle prompt or Clean.
  Bind `127.0.0.1` or leave the host out (every address): the port link only
  covers those. The indicator and hover list appear on the next snapshot, up to
  30 s later. Kill every server you started with `kill <pid>` when done; `stop`
  does not know them. No `lsof` is needed on Linux.
- **Stop** (`ports`): `thread-glance stop "finished 1" 18766` presses `Stop`
  (`armed.text` `Confirm stop`), presses it again and prints `toast`
  (`Stop requested for :18766`), `closed` true once nothing accepts a
  connection on the port, and `snapshot`, the plugin's fresh port list.
  `--once` stops at the arm; `--expire` waits 4.5 s and prints
  `afterExpiry.text` `Stop` again.
- **Port link machine** (`port-link`):
  `thread-glance port-link "dev-box" --hover "finished 1" --second-window --reload`
  picks the run's machine on the settings page's This device:
  `stored.portLinkMachine` holds its id, `secondWindow.followed` and
  `reloaded.kept` are true, and the hover card's `ports[].href` is
  `http://127.0.0.1:<port>`. `port-link "No machine"` clears it. The machine is
  `dev-box` in a run; `before.options` lists the choices.
- **Lifecycle** (`actions`):
  `thread-glance lifecycle snooze "finished 2" "1 hour"` opens the card's clock
  menu (`clockMenu` lists the presets with their wake times), picks the preset
  and prints `toasts` (`Thread snoozed`, `Wakes …`), `lifecycle` (the plugin's
  row: `snoozeUntil`) and `after` (the `Snoozed (1)` header).
  `lifecycle park|pin|unpin <title>` does the same for those; `resume`, `wake`
  and `unsettle` press the slim row's restore button (open the shelf with
  `--shelf parked|snoozed|settled`). `--menu` takes any of them through the
  thread menu instead (`Snooze ▸` for a snooze). `Pick date & time…` and the
  Parent… and Project ▸ dialogs have no verb.
- **Settle and the ports prompt** (`settle-prompt`): with a server owned by
  `finished 1`, `thread-glance settle "finished 1" --ports close` presses the
  card's `Settle` button (`--menu`: the menu's), prints `settled`
  (`Thread settled`), `prompt` (`Close this thread's ports?`,
  `Stop the processes listening on :18765?…`), `promptPorts`,
  `lifecycle.settledAt`, and after `Close ports` the `outcome` toast
  (`Stop requested for port processes`) and `listeningAfter` false.
  `--ports keep` presses `Keep open` (`promptGone` true, the server still
  listening). `--unsettle-first` un-settles through the server before
  answering: `promptAfterUnsettle` is false, the prompt leaves with the settle.
  A thread owning no port raises no prompt (`prompt` null).
- **Clean** (`clean`): Clean skips a settled thread whose workspace is shared
  with any thread that is not settled and quiet, so settle threads that sit in
  a workspace of their own: `spawn … "wt a" hi --worktree`, then start the
  server from that thread's environment path
  (`drive-bb-plugins bb … thread show <id> --json | jq -r .environment.path`)
  with `BB_THREAD_ID=<id>`, then `settle "wt a" --ports keep`.
  `thread-glance clean --cancel` presses Clean (`collapsedWhenPressed` true
  while Settled is closed) and prints `preview.threads` (`wt a`, `:18769 node`,
  `Open`), `preview.lines` (both warnings) and presses Cancel; with nothing to
  close it reads `No live terminals or thread-owned listening ports found.` and
  the button is `Close`. `clean --run` presses `Clean resources` and prints
  `result.lines` (`0 terminals closed · 1 port shutdown requests sent`),
  `toasts`, and `after` (the thread still on Settled); the port stops
  listening. `clean --run --wait 125` holds past the preview's 120 s: the
  dialog reads `Cleanup preview expired. Review the resources again.`, and
  `--refresh` presses `Refresh preview`. `--scope <project>` limits the
  preview.
- **Terminals for Clean** (`clean`):
  `drive-bb-plugins bb … terminal create --thread <id> --title devserver --command "BB_THREAD_ID=<id> node -e …" --json`
  starts a terminal in the thread's workspace, its process owned when the
  command sets `BB_THREAD_ID` and not otherwise. The preview reads
  `2 terminals · :18772 node` and `Clean resources` closes the terminals, which
  ends their processes (`0 port shutdown requests sent`). Settling a thread
  first closes its terminals that never had input, so create the terminal after
  the settle.
- **Settings page** (`settings`): `thread-glance settings` prints `nav`, the
  `groups` headings, every field's value under `fields` and the server's
  `stored` record.
  `thread-glance set "Hours before inactive" 12 --second-window --reload` types
  the value, prints `stored.statuses` (`Saving…`, `Saved`) and `stored.value`
  12, with `followed` and `kept` true. Switches take `on|off`
  (`set "Working shelf" on` adds the Working shelf;
  `set "Compact working threads" on` draws working threads as folded cards,
  `card` `folded`), selects the option's label
  (`set "Show stripes in" "Full mode only"`), text the text.
  `set "Days before auto-settle" 0` saves nothing: `stored.alerts` holds the
  inline error and `stored.value` stays.
- **Thread menu** (`menu`): `thread-glance menu "finished 2"` opens the row's
  `…` menu and prints `items` (label, `disabled`, `submenu`) and
  `focusAfterEscape`, the `…` button. `--context` right-clicks (focus returns
  to the row's link), `--keyboard` presses Enter on the button, `--sub Snooze`
  also reads that submenu.
- **Reorder** (`reorder`): under Manual order,
  `thread-glance reorder "finished 2" down` presses Alt+Arrow Down on the row:
  `announcement` reads `finished 2 moved to 3 of 4 in Active`, `after.stored`
  is the server's manual order with the two swapped. At an end it reads
  `… is already last in Active`. `reorder "finished 1" --onto "unread 1"` drags
  with the pointer; the dragged row stops next to the target.
- **Window** (`window`): `thread-glance scroll` scrolls the sidebar top to
  bottom and back; every step has `outside` and `missing` 0 (the first nine
  rows, which bb's jump keys reach, stay mounted), and `walkAlwaysSame` is
  true: bb's next and previous walk reads the same threads in order.
- **Remount** (`remount`): `thread-glance remount` picks
  `Thread list (built-in)` in Settings → Appearance, sees the list gone
  (`away`), picks `Thread Glance` again, and prints the rows before and after;
  `--via automatic` returns through `Automatic`, which leaves the provider at
  `__automatic__`.
- **Keys** (`keys`): `thread-glance enter <title>` focuses the row's link and
  presses Enter (`current` is the title).
  `thread-glance shortcut <n> [--scroll <px>]` presses bb's jump key,
  Control+Shift+n, and `shortcut next|previous --from <title>` Control+Shift+]
  or [; `same` is true when bb opened the thread its keyboard walk puts there.
- **Phone** (`--mobile`; `phone`): every verb first opens the sidebar's drawer.
  `thread-glance long-press <title> --mobile` presses the row for 800 ms, which
  opens the thread menu as a drawer (`items`; no `Open in split`), and lifting
  chooses nothing (`openAfterLift` true, `navigated` false); `--move 24`
  cancels it (`items` null): bb cancels when the finger moves, but Chromium
  sends no `touchmove` inside its touch slop, about 15 px.
  `thread-glance drawer --mobile` opens a thread, which closes the drawer, and
  reports the rows mounted closed and open again.
- **Working shelf and folded card**: `spawn … busy hi --hold 300` puts a
  thread to work; with the Working shelf on, `list` shows `Working` and its
  rows `card` `folded`, each with the port indicator when its workspace has
  listeners. A working thread's chip reads `working`; a busy thread offers no
  Snooze, Park or Settle button.
- **Machine offline**: `drive-bb-plugins machine offline` stops the host
  daemon, so the plugin's port scan fails; the indicators stay on the last
  snapshot (the plugin keeps it for up to 5 minutes). `machine online` brings
  the machine back, and doctor passes again.

A step no verb covers is added to `verbs/thread-glance.mjs` in the same pull
request as the drive that needed it, as [the README](README.md#driving-conventions)
says.

## Gotchas

- Shelves other than Pinned, Active and Working start collapsed, and a
  collapsed shelf draws no rows: a verb on a parked, snoozed or settled
  thread needs `--shelf <name>`. The list is two lists (Pinned and Active;
  then Working to Settled), which `list` reads in order.
- Shelf, sort, open child lists and collapsed groups are the browser's, read
  when a window mounts: a second window does not follow them. Settings-page
  changes and the lifecycle rows follow at once, and so does the port link
  machine, which is the only device choice on the settings page.
- Each verb run is a new browser profile, so device state starts empty and
  the port link machine is "No machine".
- A fresh run shows every ports-carrying card at once: all threads of the
  project share one checkout, so one listener in it marks every card and
  every hover card. Clean's per-thread preview needs a workspace of its own
  per thread.
- A process started from a terminal or your shell has no `BB_THREAD_ID`, so a
  recipe sets it; only a single `BB_THREAD_ID` naming a thread of that
  environment makes a port owned. bb gives an agent's own processes theirs,
  which a drive cannot check, since the fake API runs no commands.
- The snapshot is up to 30 s old: wait for the indicator rather than reading
  it at once, and a closed port leaves the list on the next refresh.
- A snooze, park or settle toast lasts 4 to 10 s, and the ports prompt stays
  until answered, so read `toasts` in the same verb that acted.
- Settle's 520 ms sweep and the list's slide on reorder are animations: the
  verbs wait about 300 ms before reading, so a read taken sooner may miss a
  new shelf header.
- Manual order holds every non-pinned thread across projects; the verb's
  `after.stored` lists titles in that order.
- Quiet threads (`seed`'s `trees`) read `pending`; their third line shows the
  machine (`dev-box`) where a fork's shows its branch (`main`), and their hover
  card `Not set` for Model and Reasoning. A fork (`states`) has a real turn.
- Pinning is bb's: `Pin` and `Unpin` change `pinnedAt`, not the plugin's
  lifecycle row, and Snooze, Park or Settle unpin a thread.
- The plugin has no groups, `Settled` fold, settings popover, `N need you`
  filter, Mark all read or `bb thread-glance prefs` command; `prefs` returns
  in a later release.
- Not covered by a verb: the Parent… and Project ▸ dialogs,
  `Pick date & time…`, inline rename, the Woke marker, project colours and
  icons, jump hints and the thread header's parent and children buttons; reach
  them with `drive-bb-plugins ui` and the roles above.
- Terminals are reachable with `bb terminal create`; Docker listeners and
  Windows machines are not, so those two remain undriven.
