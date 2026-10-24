# Thread Glance

Replaces bb's sidebar thread list. A project scope picker sits over shelves:
Pinned and Active above, then Working (a setting), Inactive, Snoozed, Parked
and Settled. A thread sits on one shelf, drawn as a full card (three lines), a
folded card (one line, Working) or a slim row (Snoozed, Parked, Settled), and
a parent's child threads fold behind a chip. Snooze, Park and Settle move a
thread between shelves from hover buttons and bb's thread menu, each with
Undo, and a thread back from a snooze, or told something while snoozed,
carries a Woke marker; a parked or settled thread told something returns to
Active. A plug icon
on a card shows that something listens in the thread's workspace; its hover
card lists those ports with Stop, a settle offers to close the ports the
thread owns, and the Settled shelf's Clean closes the terminals and owned
ports of settled threads. Settings are one record on the bb server, edited on
a settings page or `bb thread-glance prefs` and followed by every window;
shelf, sort and chip state, and the port link machine, stay in the browser.

## Sub-features

- `list`: the scope picker, shelf headers and one card per top-level thread,
  or a scene where nothing is left to do.
- `cards`: the full, folded and slim rows, their status slot, port indicator
  and buttons.
- `children`: the chip that opens a parent's child list.
- `shelf`: opening and collapsing a shelf; Active's sort; Settled's Load more.
- `scope`: limiting every shelf to one project.
- `hover`: the hover card on a row.
- `actions`: Snooze (presets or a picked time), Park, Resume, Wake, Settle,
  Un-settle, Pin and Unpin, from hover buttons, slim-row buttons and the
  thread menu, and Undo on their toasts.
- `woke`: the Woke marker on a thread back from a snooze, or one that
  needed attention while snoozed, and its dismissal.
- `menu`: bb's thread menu on a row with the list's items added, and its
  Parent… and Project ▸ dialogs.
- `rename`: renaming a row inline, the editor keeping focus until the user
  leaves it.
- `reorder`: moving a row with Alt+Arrow or the pointer.
- `ports`: the port indicator, "Workspace ports (N)" and Stop.
- `port-link`: the port link machine on the settings page.
- `settle-prompt`: "Close this thread's ports?" after a manual settle.
- `clean`: the Clean button and "Clean settled resources?" dialog.
- `settings`: the settings page and its autosave, and the same record from
  `bb thread-glance prefs`.
- `appearance`: project colours, stripes and icons, and removing a project,
  from the settings page.
- `header`: the thread header's Back to parent and children buttons.
- `window`: the list mounts only the rows near the view.
- `remount`: switching the sidebar list away from Thread Glance and back.
- `phone`: a long press and the sidebar drawer on a phone.
- `keys`: Enter on a row, bb's thread shortcuts and the jump hints.

## How to get to it (user POV)

- The sidebar, once Thread Glance is the thread list: automatic on a bb with no
  other list plugin, or Settings → Appearance → `button "Sidebar thread list"`
  → `menuitem` starting `Thread Glance`, or
  `bb settings ui set sidebar.threadListProvider thread-glance/thread-glance`.
- Scope: `button "Project scope: <All projects|project>"`, which opens a
  `combobox "Filter projects"` over `listbox "Projects"` of `option`s
  (`No projects match.` when the filter leaves none). The scope is not kept: a
  new window starts on All projects.
- Shelf headers: `button` named `Pinned`, `Active`, `Working`, `Inactive`,
  `Snoozed`, `Parked` or `Settled` with `aria-expanded`, named `Name (N)` while
  collapsed. Pinned, Active and Working start open, the rest collapsed. A shelf
  with no threads in scope is not drawn. A faint rule runs from each header's
  chevron to its controls, inside the toggle. Active's header holds
  `combobox "Sort Active"` (Manual order, Recent activity, Date created,
  Project) while Active is open; Project sort heads each project with two or
  more Active threads with `button "Collapse <project> group"`, and, beside the
  sort, `button "Group by worktree"` (`aria-pressed`) that flips the setting of
  the same name; with it on, two or more root threads sharing a bb worktree sit
  under `button "Collapse <branch> worktree group"` inside their project's
  group, whose header shows the most urgent mark while collapsed. No verb
  covers these controls yet. Settled's
  header holds `button "Close terminals and ports of settled threads"`, a broom
  icon with no text, shown collapsed too. Settled draws 10 rows, then
  `button "Load N more"` adds up to 25 at a time.
- A collapsed shelf still draws the open thread's row and, while
  `Show children that need attention` is on, every root that needs you or has
  failed in its tree; its `Name (N)` counts them all.
- Scenes, in place of the upper rows: `All clear. Time to touch some grass.`
  when Pinned, Active, Working and Inactive are empty in scope; a Working line
  (`Your agents are typing. …`, one of 18) when the Working shelf is on and
  every root in scope, settled ones included, is on it.
- Rows: `link` named for the thread's title, one `link` per card; a card has
  `button "Snooze <title>"` and `button "Settle <title>"` (full and folded
  cards, not busy or woke), `button "Thread actions for <title>"`, and
  `button "Unpin <title>"` on a pinned one (drawn twice, for touch and for
  hover). Park has no button of its own: it is the last item of Snooze's clock
  menu. A slim row's restore button is `button "Resume thread"` (Parked),
  `"Wake thread now"` (Snoozed) or `"Un-settle thread"` (Settled). A full or
  folded card's status slot reads `Needs you`, `Send failed`, `Queued`, bb's
  indicator (`Failed`, `Unread`, `Working` and the rest), else the age (`now`,
  `7m`). A Settled slim row has the status slot too (`Failed`, `Unread` or
  the age); a Parked or Snoozed slim row has plain text instead, `Waiting 0d`
  or the time left until the wake (`5m`, `2h`, `3d`). On a phone a full card has no Snooze, Settle or `…` button.
- Woke marker: a thread back from a snooze, or one that needed attention
  (a reply, a failure) after it was snoozed, has, on Active, a bold title, `Woke` in its
  status slot and `button "Dismiss Woke marker"` in place of Snooze and
  Settle; opening the thread clears it too.
- Rename: a double-click on a row's link, or the menu's `Rename`, swaps the
  link for `textbox "Rename <title>"`, which takes focus back from anything
  but the user until a press outside it, Tab, Enter (saves) or Escape (keeps
  the title).
- Children chip: `button` named `N child thread(s), 1 failed, 1 need you…`
  with `aria-expanded`; open, it lists the children under the card.
- Port indicator: `img "N workspace port(s)"` on a card's third line and on a
  folded card; none on a slim row.
- Hover card (pointer rests on a row 250 ms; keyboard focus opens it at once):
  the title, then `Project`, `Machine` and `Branch` where the thread has them,
  `Harness`, `Model`, `Reasoning`, a pull request when the branch has one,
  `button "Subthreads (N)"` on a parent, which lists the children, and
  `Workspace ports (N)`
  with one entry per listener: `:port`, the executable name and
  `button "Stop <process> on port <port>"` (then
  `"Confirm stopping <process> on port <port>"`, text `Confirm stop`). An entry
  is a link to `http://127.0.0.1:<port>` (`https` for 443 and 8443;
  `http://[::1]:<port>` for a `::1`-only socket) when the port link machine is
  its machine.
- Thread menu (`menu "Thread actions for <title>"`, from the `…` button or a
  right-click): `Open in split`, `Parent…`, `Project`, `Copy thread link`,
  `Copy branch`, `Copy thread ID`, `Mark unread`, `Pin`, `Snooze` (submenu of
  the presets and `Pick date & time…`), `Park thread`, `Settle`, `Rename`,
  `Notifications`, `Archive`, `Delete`; `Resume` on a parked thread, `Wake now`
  on a snoozed one, `Un-settle` on a settled one, `Unpin` on a pinned one. A
  busy thread's menu has no `Snooze`, `Park thread` or `Settle`, and a woke
  one no `Snooze`; a thread of the Personal project has no `Project`. A child in an
  open child list has the same menu on a right-click. On a phone a long press
  opens it as a drawer, with no `Open in split` and with bb's
  `New thread in environment`.
- Menu dialogs: `Pick date & time…` opens `dialog "Snooze until"` (a calendar
  of day `button`s named like `Tuesday, October 20th, 2026`,
  `button "Go to the Next Month"`, `textbox "Time"`, a `Wakes …` line,
  `Cancel`, `Snooze`). `Parent…` opens `dialog "Parent"` with
  `combobox "Search threads"` over `listbox "Parent"` (`None`, then threads).
  `Project ▸` (`menu "Project"`) has `Project settings` (bb's project settings
  page), `Rename project` (`textbox "Project name"`, `Rename`),
  `Add local path` (`combobox "Machine"`, `textbox "Folder"`, `Add path`) and
  `Remove project` (enabled once `textbox "Project name"` holds the name;
  removes the project's threads too).
- Toasts: `Thread parked`, `Thread snoozed` (with `Wakes …`),
  `Thread settled`, `Thread woke up`, `Thread returned to Active`, each with
  `Undo` (a settle's Undo then toasts `Settling undone`); snooze, park and
  settle add `Agent session stopped` when they stopped a loaded session, and a
  settle `closed N terminals nobody used` when it closed any. The ports prompt
  `Close this thread's ports?` with `Keep open` and `Close ports`, or
  `Thread settled, but its ports could not be checked` when the machine is
  unreachable; `Stop requested for :<port>`.
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
  `status` beside the page heading reads `Saving…` then `Saved`, or
  `Not saved` with the toast `Could not save sidebar settings`; an invalid
  value shows a `role=alert` line under its field and saves nothing.
  Project appearance's `Customize a project` drives a `group "Preview"`,
  `textbox "Project colour"` (`#rrggbb`, saved 500 ms after the last change),
  `Reset`, `Upload icon` and `Use automatic`; Project management has
  `combobox "Remove a project"`, `textbox "Project name"` and
  `button "Remove project"`.
- Project mark: an uploaded icon, else the project's favicon, else a
  monogram marks the project, whatever `Project colors` says. With
  `Project colors` on, each card's project name takes the project's colour,
  the monogram's tile its tint, and a stripe its fill, where
  `Show stripes in` allows.
- Jump hints: while Control is held alone, bb's own labels, `Ctrl + Shift + 1`
  … `Ctrl + Shift + 9`, stand in the status slots of the list's first nine
  rows, from the upper list on and into the lower one where the upper holds
  fewer; Shift held too shows none.
- Thread header (an open thread): `button "Back to parent: <title>"` on a
  child, and on a parent a button reading `1 child`, `N children` or
  `Needs you` that opens `region "Child threads"`, one button per child.

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
  `shelves` (`shelf`, `label`, `expanded`, `sort`, `clean`, `rule`, the rule's
  width in px), `rows` (`id`, `title`, `shelf`, `group`, `card`
  `full|folded|slim`, `current`, `status`, `bold`, `woke`, `ports`, `chip`,
  `buttons`, `labels`, `text`, `stripe`, `projectColour`, `projectIcon`,
  `children`), `groups`, `loadMore`, `allClear` and `scene` (`name`
  `all-clear|working` and its text; `scope Personal` shows All clear). On a
  fresh run, after
  `seed` of
  `{"trees": [{"count": 3, "children": 1, "title": "alpha"}], "states": {"finished": 2, "failed": 1, "unread": 1}}`,
  every thread is on Active. `list --wait <title>` waits for a row,
  `list --open <title>` opens one. A fork's `labels` hold `Branch` and
  `Machine: dev-box`. A row whose shelf is collapsed is not in `rows` until
  `--shelf` opens it, unless the shelf keeps it (How to get to it).
- **Children** (`children`): `thread-glance children "alpha 1" expand --reload`
  turns the chip's `expanded` true, lists the child under `after.children`,
  `stored.expandedParents` holds the parent's id and `reloaded.kept` is true.
  `--second-window` ends `followed` false: the open parents are read when a
  window mounts.
- **Shelves** (`shelf`): `thread-glance shelf active collapse --reload` labels
  the header `Active (N)`, `stored.collapsedShelves` is `{"active": true}`,
  kept after a reload, and `after.rows` keeps any failed thread.
  `shelf settled expand` opens Settled once a thread is settled.
- **Load more** (`shelf`): with more than 10 settled threads (seed a tree,
  then settle each id from `seed.json` with
  `drive-bb-plugins bb … plugin rpc call thread-glance settle --input-file <file holding {"threadId":"<id>"}> --json`),
  `thread-glance more` opens Settled and presses `Load N more`: `before`
  reads `Load 23 more` and 10 settled for 33, the step `loadMore` null and 33.
  `--times <n>` presses it again.
- **Active sort** (`sort`): `thread-glance sort "Recent activity"` re-orders
  `after.order` and stores `activeSort` `activity`; `Project` adds a `groups`
  header (`Collapse drives group`) for a project with two Active threads;
  `Manual order` is the default.
- **Scope** (`scope`): `thread-glance scope drives` lists the picker's
  `options` and the rows left; `scope "All projects"` clears it; with no
  argument it only reads the options. `--filter dri` types into the filter
  first (`options` only `drives`); `--filter zzz` leaves none and `empty`
  reads `No projects match.`
- **Scenes** (`list`): `scope Personal` on a run whose threads are all in
  `drives` prints `after.scene.name` `all-clear`. The Working scene needs the
  Working shelf on and nothing but working roots in scope: archive every other
  thread (`drive-bb-plugins bb … thread archive <id>`), `spawn … worker hi --hold 300`,
  and `list` reads `scene.name` `working`.
- **Hover card** (`hover`, `ports`): `thread-glance hover "finished 1"` rests
  the pointer on the row and prints `indicator` (the card's port indicator
  name) and `card.lines`, `card.portsHeading` and `card.ports[]` (`port`,
  `process`, `href`, `stop.name|text|armed`). A thread forked from a real turn
  reads `Model` `claude-opus-5-5[1m]`; a quiet thread `Not set`.
  `hover "alpha 1" --subthreads` presses `Subthreads (1)` and
  `card.subthreads.lines` ends with `alpha 1.1`.
- **Giving a thread a listening port**: ports come from real processes on the
  run's machine (this one), and the fake API cannot run commands, so start one
  yourself, with a working directory inside the thread's workspace. Every
  `seed`ed or `spawn`ed thread of the `drives` project shares the project's
  checkout, `<scratch>/work/demo` (`scratch` in the evidence's `run.env`), so
  one server shows on all of them:

  ```bash
  cd "$(. "${TMPDIR:-/tmp}/drives-$(id -u)/bb-plugins/<run>/run.env"; echo $scratch)/work/demo" && BB_THREAD_ID=<thread id> node -e 'require("http").createServer((q,r)=>r.end("ok")).listen(+process.argv[1],"127.0.0.1")' 18765 >/dev/null 2>&1 & echo $!
  ```

  With `BB_THREAD_ID` naming one thread of that workspace the port is that
  thread's **owned port**; without it, or naming another, it belongs to the
  workspace and shows with Stop but is never in the settle prompt or Clean.
  Bind a loopback address (`127.0.0.1`, `::1`) or leave the host out (every
  address): the port link only covers those. The indicator and hover list
  appear on the next snapshot, up to about 40 s later. Kill every server you started with `kill <pid>` when done; `stop`
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
  thread menu instead (`Snooze ▸` for a snooze); `park` and `pin` always do.
  `--undo` then presses the toast's `Undo` and prints `undone` (`lifecycle`
  back, the toasts and list after).
- **Pick a time** (`actions`):
  `thread-glance snooze-at "alpha 3" 2026-11-03 14:30` opens
  `Snooze ▸ Pick date & time…`, picks the day and types the time: `dialog` reads
  `Wakes Tue, Nov 3, 2:30 PM`, then `toasts` and `lifecycle.snoozeUntil`
  (`wakesAt`). `--cancel` presses Cancel and stores nothing.
- **Woke** (`woke`): `drive-bb-plugins bb … thread-glance prefs set snoozeShortcuts '"1m, 1h"'`
  adds a `1 minute` preset; `lifecycle snooze "failed 1" "1 minute"`, then
  `thread-glance woke "failed 1"` waits (up to `--wait`, 90 s) for the marker:
  `before` has `status` `Woke`, `woke` true and `Dismiss Woke marker` in
  `buttons`; after the press `woke` is false. `--open` opens the thread
  instead. Reset `snoozeShortcuts` after.
- **Rename** (`rename`): `thread-glance rename "alpha 2" "alpha two" --steal`
  double-clicks the link: `focusAtOnce` and `focusLater` (1.5 s on) are
  `INPUT` `Rename alpha 2`, and so is `focusAfterSteal` after focus moves to
  the composer; Enter saves, `stored` `alpha two` (bb's title). `--menu` opens
  it from the menu's `Rename`; `--escape` keeps the title.
- **Parent** (`menu`): `thread-glance parent "unread 1" "alpha 1"` picks
  `alpha 1` in the Parent… dialog: `stored` is its id and the list's chip
  reads `2 child threads`. `parent "unread 1" None` on the child (reached by
  right-clicking it in the open child list) makes it a root again.
- **Project ▸** (`menu`):
  `thread-glance project "failed 1" "Rename project" drives2 --confirm` renames
  the project (`projects`, and the cards' project line); without `--confirm` it
  types and reads `actionEnabled`, then Escape. `"Add local path" /tmp` and
  `"Remove project" drives` read `actionEnabled` true; `"Project settings"`
  prints the `url` it opened. `"Remove project" drives --confirm` removes the
  project and every thread in it, so it goes last in a run.
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
  A thread owning no port raises no prompt (`prompt` null). `--undo` presses
  the settle toast's `Undo` and prints `undone` (`Settling undone`, the
  lifecycle row cleared); `lifecycle` has no settle.
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
  `result.lines` (`0 terminals closed · 1 port shutdown request sent`),
  `toasts`, and `after` (the thread still on Settled); the port stops
  listening. `clean --run --wait 125` holds past the preview's 120 s: the
  dialog reads `Cleanup preview expired. Review the resources again.`, and
  `--refresh` presses `Refresh preview`. `--scope <project>` limits the
  preview.
- **Terminals for Clean** (`clean`):
  `drive-bb-plugins bb … terminal create --thread <id> --title devserver --command "BB_THREAD_ID=<id> <node> -e …" --json`
  starts a terminal in the thread's workspace, `<node>` being node's absolute
  path (`command -v node`), since the terminal's login shell need not find
  node on its own `PATH` (the terminal then exits 127 with
  `node: command not found`, which `terminal output <id>` shows); its process
  is owned when the
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
- **Project appearance** (`appearance`): after `set "Project colors" on`,
  `thread-glance appearance drives --colour "#ff0000"` types the colour:
  `after.colour`, `appearance.value.colours` holding it, and the project's
  `rows` with `stripe` `rgb(255, 0, 0)` and a contrast-nudged
  `projectColour`. `--icon <png>` uploads an icon (`lines`
  `Uploaded: <name>`, `projectIcon` true), `--automatic` returns to
  `Found automatically from the project's favicon.`, `--reset` clears the
  colour, and `--colour "#zzz"` reads `alerts` `Use a colour like #1a2b3c.`
- **Remove a project** (`appearance`): `thread-glance remove-project drives`
  types the name: `enabled` true; a wrong name leaves it false. `--confirm`
  removes it.
- **Thread header** (`header`): `thread-glance header "alpha 1" --children`
  opens the thread: `children` `N children`, and `popover.buttons` one per
  child. `header "alpha 1.1" --back` reads `back`
  `Back to parent: alpha 1`, presses it, and `current` is `alpha 1`.
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
  with the pointer; the dragged row takes the target's slot and nothing is
  announced. Under Recent activity or Date created nothing moves; Pinned
  reorders under every sort, through bb, so `after.stored` stays.
- **Window** (`window`): `thread-glance scroll` scrolls the sidebar top to
  bottom and back; every step has `outside` and `missing` 0 (the upper list's
  first nine rows, which bb's jump keys reach, and the open thread's row stay
  mounted), and `walkAlwaysSame` is true: bb's next and previous walk reads
  the same threads in order. On `user-800`, saved days ago, auto-settle draws
  most roots on Settled and the rest on Inactive, which leaves a handful of rows
  to scroll: first `thread-glance prefs set settleQuietThreads false` and
  `prefs set inactiveShelf false` through `drive-bb-plugins bb`, which puts
  every live root on Active.
- **Remount** (`remount`): `thread-glance remount` picks
  `Thread list (built-in)` in Settings → Appearance, sees the list gone
  (`away`), picks `Thread Glance` again, and prints the rows before and after;
  `--via automatic` returns through `Automatic`, which leaves the provider at
  `__automatic__`. Each step is a fresh page load, so it does not exercise a
  remount inside one window.
- **Keys** (`keys`): `thread-glance enter <title>` focuses the row's link and
  presses Enter (`current` is the title). `thread-glance hints` holds Control
  900 ms: `held` lists `Ctrl + Shift + 1` … per row, `released` 0;
  `--with Shift` shows none.
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
  snapshot until a machine answers, and a settle raises
  `Thread settled, but its ports could not be checked` (`settle`'s `prompt`).
  `machine online` brings the machine back and doctor passes again; the scan
  retries on a backoff of up to 5 minutes, so fresh ports may lag that long.

A step no verb covers is added to `verbs/thread-glance.mjs` in the same pull
request as the drive that needed it, as [the README](README.md#driving-conventions)
says.

## Gotchas

- Shelves other than Pinned, Active and Working start collapsed, and a
  collapsed shelf draws only the rows it keeps: a verb on a parked, snoozed,
  settled or inactive thread needs `--shelf <name>`. The list is two lists (Pinned and Active;
  then Working to Settled), which `list` reads in order.
- Shelf, sort, open child lists and collapsed groups are the browser's, read
  when a window mounts: a second window does not follow them. Settings-page
  changes and the lifecycle rows follow at once, and so does the port link
  machine, which is the only device choice on the settings page.
- Each verb run is a new browser profile, so device state starts empty and
  the port link machine is "No machine".
- A fresh run shows every ports-carrying card at once: the spawned and forked
  threads of the project share one checkout, so one listener in it marks
  every one of their cards and hover cards; quiet threads have no workspace and
  show no ports. Clean's per-thread preview needs a workspace of its own
  per thread.
- A process started from a terminal or your shell has no `BB_THREAD_ID`, so a
  recipe sets it; only a single `BB_THREAD_ID` naming a thread of that
  environment makes a port owned. bb gives an agent's own processes theirs,
  which a drive cannot check, since the fake API runs no commands.
- The snapshot is up to 30 s old and the list asks every 10 s, so a new port
  takes up to about 40 s to show: wait for the indicator, or call
  `plugin rpc call thread-glance ports` with `{"fresh":true}` first. A closed
  port leaves the list on the next refresh. A settle's ports prompt reads
  fresh, so it does not wait.
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
- Auto-settle is on at install (`settleQuietThreads`, after
  `daysBeforeAutoSettle` 3 days, and `settleMergedPullRequests`): a root quiet
  that long, or whose pull request merged or closed, draws on Settled with no
  one settling it, and draws on Active again once the setting is off. A
  snapshot saved days before opens that way.
- Pinning is bb's: `Pin` and `Unpin` change `pinnedAt`, not the plugin's
  lifecycle row, and Snooze, Park or Settle unpin a thread.
- The plugin has no `Settled` fold, settings popover, `N need you` filter or
  Mark all read, and no groups but Project sort's.
  `bb thread-glance prefs list|get|set|reset` changes the settings record the page edits (keys and
  ids, such as `stripesIn` `full`; an invalid value fails with
  `invalid_preference_value` and stores nothing); run it with
  `drive-bb-plugins bb … thread-glance prefs …` and read `settings` or an open
  sidebar back.
- A pointer is needed for hover cards, Stop, the clock menu and the `…`
  button: with `--mobile` only `resume`, `wake`, `unsettle` and `unpin` reach
  their buttons, and a phone's menu is `long-press`.
- `scroll` measures against the first scroller: with
  `Dock shelves to the bottom` on, the docked lower list scrolls on its own
  and is not measured.
- Terminals are reachable with `bb terminal create`; Docker listeners and
  Windows machines are not, so those two remain undriven.
