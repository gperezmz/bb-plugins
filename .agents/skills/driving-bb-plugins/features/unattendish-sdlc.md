# Unattendish

Wakes the manager thread of an Unattendish fleet when the tracker or forge it
waits on changes, and shows the operator their fleets: a Fleets page with
a fleet board with one line per fleet and, under it, one queue of
everything that waits on them; a Fleet chip and a Fleet tab on each manager thread; a toast for a new Inbox
row and for a fleet no account can read; a Connect… popup that verifies a
read-only token before storing it; and a settings section for accounts and
poll intervals. Answer…, Grant… and Build it send the manager one plain
message, and the plugin writes nothing to a tracker. A manager registers its
fleet with `bb unattendish fleet register`, from its own thread.

## Sub-features

- `page`: the Fleets page: the title bar's count, the fleet board (a line per
  fleet, its filter, its fix, the quiet fleets folded) and the queue (tabs by
  kind, Sent, the filter chip), and its states in between.
- `header`: the fleet header, as the Fleet tab opens on it and the chip's
  hover card shows it: forge and tracker, manager, Status counts, spend, each
  problem and warning as a strip with its verb, and the last action.
- `actions`: Answer…, Grant… and Build it on a queue row, then `sent`, `done`
  or `not sent`.
- `chip`: the Fleet chip in a manager's header, and the fleet header it shows
  on hover.
- `tab`: the Fleet tab: the fleet header over the Work, Notes, Watching and
  Ledger tabs.
- `toasts`: the new-Inbox-row toast and the needs-an-account toast.
- `connect`: the Connect… popup: Connect, Add a token, Renew a token, Add
  account.
- `settings`: accounts, their tokens, the default, and each fleet's poll
  interval.
- `cli`: `bb unattendish fleet register|unregister|status|ledger|interval`,
  and the wake a manager receives.

## How to get to it (user POV)

- `navigation "Primary navigation"` → `button "Fleets"`: the page, at
  `/plugins/unattendish-sdlc/fleets`. The title bar's count is
  `N waiting on you`, the Inbox rows across fleets (the board's Status slots
  carry the same words per fleet), absent at zero. While the first load runs the
  page is `status "Loading your fleets"`; when it fails with nothing shown it is
  `alert "Couldn't load your fleets"` with the error and `button "Try again"`;
  with no fleet it says `No fleet is registered` and `/run-fleet`.
- `region "Fleet board"`: a `listitem "Fleet <repo>"` per fleet (`<repo>` as
  registered, `github.example/org/dash`), in the order problems, warnings, then
  most waiting. A line holds, in order, the forge's logo, `button "<repo>"`
  (`aria-pressed`: the fleet the queue is filtered to; clicking the line
  anywhere but a button does the same), the tracker's logo and key when the
  tracker is Linear or Jira, the manager (an icon named `Manager working`,
  `Manager idle for 12s` or `No manager: its thread is archived or gone`), the
  four Status slots, spend (with Thread Usage installed), the polling cell
  (`not yet`, or `9m late`; empty while polling is healthy), the fix and
  `button "Open the Fleet tab of <repo>"`. A slot is named for its count
  (`1 blocked`, `2 in flight`, `4 waiting on you`,
  `1 landed in the last 7 days`) and a count of zero draws nothing. The fix, for
  a fleet with a problem or warning, is a coloured verb (`Review`, `Connect…`,
  `Renew…`, then `+N` for the rest) whose accessible name is every sentence
  (`other-org/x needs a GitHub account that can read other-org`), or, where
  nothing on the page fixes it (a gone manager:
  `The manager thread is archived or gone: run /run-fleet in a new thread to take the fleet over`),
  a ✕ with that name and no button. Quiet fleets, every count zero and nothing
  flagged, fold under `button "1 quiet fleet"` (`aria-expanded`), a filtered one
  stays listed. Below 768 px the board shows three lines, the rest under
  `button "2 more fleets"`; a line holds the logo, the fleet's short name
  (`dash` for `github.example/org/dash`; its toggle is named by the full name),
  a touch-sized icon
  button named by the sentence in place of the verb, and the non-zero slots, and
  has no Fleet tab button.
- `region "Queue"`: `tablist "Kind"` with `tab "All 4"`, `Answer`, `Grant`,
  `Build`, `Other`, `Unreadable` (only while a row is unreadable) and `Sent`,
  each followed by its count, then `tabpanel "<tab>"` with a `listitem` per row,
  oldest first. A row reads `#7 Which cache to use`, `link "#7 ↗"` (the item),
  its age (`11h 1m`, amber from 8 hours), the fleet (left out while the queue is
  filtered to one) and its action. A filter adds, at the right of the tabs, the
  fleet's name and `button "Show every fleet, not only <repo>"`; each tab counts
  that fleet's rows alone. An unreadable row is
  `Unreadable Inbox row, line 9: <why>` with
  `button "Review the manifest of <repo> in its Fleet tab"`. A tab with no row
  says `Nothing waits on you` (Sent:
  `Nothing you sent was seen done in the last hour`); Sent lists
  `You answered #5 Which queue`, its age and `done`, for what was seen done in
  the last hour. Below 768 px a row is three parts, its `listitem`'s first
  three children: the title (wrapping to two lines), the details (the short
  name, with the full name as screen-reader text, then the link, which is
  `↗` alone named by its full text where it has no short form, and the age),
  and the action line (buttons across the row, `Not sent: <reason>` and the
  unconfirmed note under them). Sent lines and the filter chip also use the
  short name; the chip's ✕ is 44 px.
- A queue row's action: `button "Answer… #7"`, `"Grant… #8"` or `"Build it #9"`
  (and `"Re-grant #8"` beside Grant… for a grant a previous manager gave);
  `watch only` for a wait on something else. Answer and Grant open, in the same
  list item under the row, `textbox "Your answer for #7"` (`Your grant for`)
  headed `Your answer for #7 Which cache to use · goes to <repo>'s manager`,
  `button "Send"` (disabled while empty) and `button "Cancel"`; Control+Enter
  sends, Escape cancels, and the row's action reads `composing…` meanwhile. The
  action then reads `sending…`, `sent · 0s` (the row stays until a poll sees it
  leave), `checking…` or `done`. A refusal of words is
  `alert "Not sent: HTTP 409: Thread is archived"` in the composer, which stays
  open with the draft; one of Build it or Re-grant is `not sent` beside the
  title, named `not sent: HTTP 409: Thread is archived`, and the button stays.
- The fleet header, at the top of the Fleet tab and in the chip's hover card,
  is a `header` labelled `Fleet <repo>` (a `banner` in the hover card only,
  since bb's panel holds the tab inside a landmark of its own): the forge's logo (`img "GitHub"`; GitLab,
  Linear and Jira as their names), `<repo>`, a Linear or Jira tracker's name
  and key; the manager (`img "Manager idle for 12s"`, `Manager working`,
  `No manager: its thread is archived or gone`); each non-zero Status count
  named as on the board (`4 waiting on you`); the spend (`$0.17`, named
  `$0.17 spent since this manager started`) with Thread Usage installed;
  `list "Problems and warnings of <repo>"`, a `listitem` strip per flag with
  the server's sentence and its verb, a button named `<verb> <sentence>`
  (`Review 1 manifest row cannot be read: Inbox`, `Connect… …`, `Renew… …`;
  none for late polling or a gone manager); and
  `You answered #5 Which queue · done 40m ago` for an action seen done in the
  last hour.
- A title-bar pill, while a refresh fails over data shown: a name starting
  `Couldn't refresh:`
  (`Couldn't refresh: <error>. Showing what was loaded 3m ago.`), text `3m old`
  and `button "Reload now"`; the board and queue stay.
- A manager's thread, at `/projects/<project>/threads/<thread>`: the chip in
  the header, `button "Fleet: 5 waiting on you, and it has a problem"`
  (`Fleet: nothing waits on you`, `…, and it has a warning`): the fleet icon,
  a small dot on it (red for a problem, amber for a warning alone) and the
  count in amber, the icon alone with nothing waiting and nothing flagged.
  Bordered on desktop, bare on a phone. Its hover shows the fleet header over
  `Click the chip to open the Fleet tab` (none on a phone); its click opens the
  `Fleet` tab; Review in the card opens the tab's Work at what needs it.
- The Fleet tab: the fleet header, then `tablist "Fleet"` (sticky) with
  `tab`s named `Work, 5 waiting on you`, `Notes, 3 sections`,
  `Watching, 4 items watched` and `Ledger` (`Ledger, 1 read failed in the last
  24 hours`, its count red), each showing its label and count; Work selected
  first, arrow keys move. Each `tabpanel` stays mounted once shown.
  Work: four `region`s, each headed by a button (`aria-expanded`) reading its
  name and count, `Waits on you 5`, `In flight 2`, `Blocked 1`, `Landed 1`
  (folded); rows in two lines (`#7 Which cache`, then `#7 ↗` and its age, the
  action at the right; In flight `at the bar for 25m` and `builder ↗`; Blocked
  `waits for #170, #172`; Landed `merged 12 Oct, 01:39`); unreadable rows
  `Unreadable row, line 9: <why>` at a section's top; a missing manifest
  `No manifest was found at the path the fleet registered.` in place of the
  sections. Notes: a `region` per written section (`Backlog`), `Nothing
  written.` under a blank one. Watching: `region`s `Watched set`,
  `Credentials` (a `listitem "Credential <label>"` card each, with
  `reads the forge`, its kind, expiry, `can write`, `shares the agents' rate
  limit` and `button "Change account… for the forge of <repo>"`) and
  `Polling` (`every 30s · polled 12s ago · 24 requests this hour`). Ledger,
  fetched once its tab is first pressed: `group "What was done"` (`All`,
  `Woke`, `Dropped`, `Held`, `Failed reads`, `Wakes`, pills),
  `searchbox "Filter by item"`, the changes as a timeline (`ol`), each with an
  icon in its outcome's colour, `Dropped, by reason` (`echo: marker · 1`),
  `Wakes`, or `Nothing in the ledger matches.`.
- Toasts, in every open window: title `#15 <What>` (the item), line
  `<repo> waits for your answer` (`a grant to merge`, `your ready label`,
  `something else`) and `Open Fleets`; title `<repo> can't be read`, the
  server's sentence
  (`other-org/x needs a GitHub account that can read other-org`) as its
  description and `Connect…`, which opens the popup.
- The popup, a `dialog` titled `Connect <repo>`, `Add a token`,
  `Renew a token` or `Add account`. Connect asks
  `Which account reads <host>/<owner>?` (radios `<account> default` and
  `a new login`) and `Continue`; Add a token asks `Owner`; Add account asks
  `Service`, `Host` and `Owner`. The token step has `Create token` (opens the
  service's token page, pre-filled read-only), radios `Paste a token` and
  `Use your gh login`, `Token`, `Verify and save` and
  `Choose another account`. The result: `Saved: GitHub · operator, operator, no expiry reported.`
  and `<repo> is read as GitHub · operator.` with `Done`; a renew adds
  `The old token still works at GitHub until it expires or is revoked there.`
- Settings → Installed plugins → Unattendish, at
  `/settings/plugins/unattendish-sdlc`: `region "Accounts"`, a `listitem`
  named for each account (`default for github.example` or `Make default`;
  each token with its owner, kind, expiry, the fleets it is read by,
  `token expires in 3 days` and `Renew` near its end, and
  `button "Remove the token for <owner> of <account>"`;
  `button "Add token for another owner to <account>"`;
  `button "Remove <account>"`, confirmed with
  `button "Confirm removing <account>"` or `Keep`), `button "Add account"`;
  and `region "Poll interval"`, a
  `textbox "Poll interval of <repo>, in seconds"` per fleet with
  `button "Set the poll interval of <repo>"` and
  `button "Reset the poll interval of <repo> to the default"`.
- RPC, `bb plugin rpc call unattendish-sdlc <method> --json`: `fleets`,
  `settings`, `threadFleet {"threadId"}`, `fleetDetail {"repo"}`, and
  `connect`, whose input is
  `{"account": {"service", "place", "apiUrl"}, "owner", "secret": {"kind": "token", "token"}, "confirm"}`
  and whose `outcome` is `confirm` (`This token belongs to buser. Add as GitHub · buser?`),
  `saved` or `refused`.
- CLI: `bb unattendish fleet register --contract 1 --repo <host/owner/name> --tracker <forge-issues|linear:<team>|jira:<site>/<project>> --manifest <path> --operator <login> --label-spec <l> --label-ready <l> --label-in-progress <l> --label-needs-input <l> --marker <text> [--echo-actor <login>] [--json]`,
  `fleet status [--json]`, `fleet ledger <repo> [--item <ref>] [--done woke|echo|out-of-scope|held|failed-read|skipped-listing] [--limit <n>] [--json]`,
  `fleet interval <repo> <30s|2m|default>` and `fleet unregister <repo>`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start unattendish-sdlc`, or
`start unattendish-sdlc thread-usage` with Thread Usage's own preconditions
for the header's spend. `start` runs the fake GitHub, GitLab, Linear and Jira
and connects one account to each (the skill's
[Fake services](../SKILL.md#fake-services)). A fleet's manifest is a file
in the run's evidence, `<evidence>/manifests/<name>.md`, in the Fleet
contract's form (`docs/reference/unattendish-fleet-contract.md`;
`plugins/unattendish-sdlc/harness/drives/lib.sh`'s `manifest` writes one),
and every repository a fleet registers is in the fake's `repos`.

- **Managers** (`unattendish.setup/spawn`):
  `A=$(drive-bb-plugins spawn unattendish.setup/spawn mgr-a hello)`, and each
  further manager `--beside $A`.
- **Fake state** (`unattendish.setup/fake`): a file such as
  `{"repos": {"org/dash": {"issues": [{"number": 7, "state": "open", "labels": [], "assignees": [], "creator": "olivia", "createdAt": "<now+3s>", "updatedAt": "<now+3s>"}], "comments": [], "events": []}}}`
  loaded with `drive-bb-plugins fake unattendish.setup/fake github state <file>`.
- **Register** (`unattendish.cli/register`):
  `drive-bb-plugins bb --as $A unattendish.cli/register -- unattendish fleet register --contract 1 --repo github.example/org/dash --tracker forge-issues --manifest <manifest> --operator olivia --label-spec spec --label-ready ready --label-in-progress in-progress --label-needs-input needs-input --marker '🤖 unattendish agent' --json`
  answers `registered`, `watched` true; `fleet interval github.example/org/dash 30s`
  answers `Polling every 30s.`. A comment on an item the manifest names wakes
  `$A` with `Moved on the tracker or the forge since <time> UTC:` and one
  line, `#7 commented by alice https://github.example/org/dash/issues/7`,
  read from `$DBP_URL` `api/v1/threads/$A/events?types=client/turn/requested`.
- **CLI refusals** (`unattendish.cli/register`): the same register from a
  second live manager is `refused` with `holder`; without `--as`, `no_thread`;
  `--contract 2`, `unsupported` with `supported` `[1]`; `--echo-actor olivia`,
  `invalid`; after `thread archive $A`, another manager's register is
  `taken-over` with `previousManager`; `fleet interval … 10s` names the
  30-second floor.
- **Trackers** (`unattendish.cli/register`): a fleet on
  `gitlab.example/group/proj`, one with `--tracker linear:ENG` (operator
  `olivia@acme.test`) and one with
  `--tracker jira:acme.atlassian.net/PROJ` (operator `acc-olivia`), each with
  its fake's state as `harness/drives/trackers.sh` loads it, wake their
  managers with one line each; `fleet status --json` names the account each
  half reads as, and every fake's `requests` holds only reads (`GET`, and
  `POST` queries for Linear).
- **Page** (`unattendish.page/nav`): `drive-bb-plugins unattendish-sdlc fleets-page`
  prints `shown` (`state` `ready|loading|cant-load|no-fleet`, `count`,
  `refreshPill`, `board.lines` with each line's `name`, `filter`, `manager`,
  `status`, `fix` and `text`, `board.fold`, and `queue` with `tabs`, `filter`,
  `panel`, `rows`, `empty`) and `stored`, the `fleets` RPC. `--unfold`
  presses the fold, `--filter <repo>` the fleet's name and `--tab Answer` a
  queue tab, and `after` reads the page once they have; `--open-tab <repo>`
  presses the line's Fleet tab icon and prints the Fleet tab it lands on;
  `--mobile` reads the condensed board (no `--open-tab`).
- **Actions** (`unattendish.actions/page`):
  `unattendish-sdlc act "Answer…" '#7' 'Go with B.\nIt is simpler.'` prints the
  composer (`header`, `sendEnabledEmpty` false) and the row after (`sent · 0s`),
  and `$A` receives `Answer to #7: Go with B.` and `It is simpler.`;
  `act "Grant…" '#8' 'Merge it.'` sends `Grant: Merge it.`, and
  `act "Build it" '#9'` sends `Build #9`. `--esc` cancels, sending nothing. Once
  the manifest no longer holds the row, the next poll takes it off the queue and
  lists the action under `Sent` (`You answered #7 …`, `done`). With the manager
  archived, `act "Grant…" '#8' 'x' --wait "Not sent:"` reads the composer's
  `Not sent: HTTP 409: Thread is archived` (`refusal.composer`) and
  `act "Build it" '#9' --wait "not sent"` reads
  `not sent: HTTP 409: Thread is archived` beside the title (`refusal.title`).
- **Chip** (`unattendish.chip/header`): `unattendish-sdlc chip $A --hover`
  prints the chip's `name`, `text`, `look` (its height, border width, the
  header row's height and its dot's colour class) and the fleet header its
  hover shows; `--review` then presses Review in that card and reads the tab
  it opens; `--open` clicks the chip and reads the tab; `--mobile` reads it on
  a phone, with no hover card.
- **Tab and ledger** (`unattendish.tab/panel`): `unattendish-sdlc tab $A`
  prints the header, its strips, the tabs and the shown panel's sections;
  `--tab Notes`, `--fold "In flight"` and `--review` act and read `after`,
  with `scrolledTo`, where each unreadable row sits in the viewport;
  `unattendish-sdlc fleets-page --open-tab <repo>` reads the tab it lands on;
  `unattendish-sdlc ledger $A --filter Dropped --item '#8'` presses the Ledger
  tab and lists `echo: marker · 1`, with each entry's outcome colour, once a
  comment ending in the marker, on a line of its own, has been polled.
- **Toasts** (`unattendish.toasts/ws`): `unattendish-sdlc toast <trigger.sh> --click "Open Fleets"`
  holds the Fleets page open while the script adds an Inbox row to the
  manifest and runs `thread tell $A hi`, `thread wait $A --status idle` and
  `thread stop $A`, then prints each toast's `title`, `description` and
  `buttons`: `#21 Which queue to use` over `<repo> waits for your answer`.
  A trigger that registers a fleet on `github.example/other-org/x` raises
  `github.example/other-org/x can't be read` over
  `other-org/x needs a GitHub account that can read other-org`;
  `--click "Connect…"` opens the popup on it and prints its `dialog`.
- **Connect** (`unattendish.connect/card`):
  `unattendish-sdlc connect "Connect…" --fleet github.example/other-org/x --account "GitHub · operator" --token ghp_connect_fake_token`
  presses the Connect… on that fleet's board line (without `--fleet`, the
  button whose accessible name is given, such as the sentence a phone's icon
  button carries), prints each step, `createTokenUrl` and the result, and
  `status` has the fleet `watched` once the fake GitHub's `repos` holds
  `other-org/x`. `--from settings` starts on the settings page:
  `connect "Add token for another owner to GitHub · operator" --from settings --owner third-org --token <token>`
  adds a token, and `connect "Renew the token for <owner> of GitHub · operator" --from settings --token <token>`
  renews one. `connect "Add account" --from settings --service GitHub --host ghe.example.invalid --owner org --token <token>`
  ends on `GitHub could not be asked whose the token is (…). Nothing was stored.`
- **A second account** (`unattendish.connect/rpc`): the `connect` RPC with
  `account.apiUrl` the fake's address (`$DBP_GITHUB` in the evidence's
  `env.sh`), after a fake state whose `logins` maps the token to `buser`,
  answers `confirm`, then `saved` with `"confirm": true`; a token `logins`
  does not hold is `refused`, `GitHub rejected the token. Nothing was stored.`
  A `tokens` entry with an `expiration` 3 days out makes that token read
  `token expires in 3 days` with `Renew`.
- **Settings** (`unattendish.settings/page`): `unattendish-sdlc settings`
  reads Accounts and Poll interval; `--interval <repo> 29` reads Set
  disabled and `The poll interval must be at least 30 seconds.`,
  `--interval <repo> 45` stores `intervalMs` 45000 and
  `--interval <repo> default` 120000; `--default "GitHub · buser"` makes it
  the default; `--remove "Remove GitHub · operator"` confirms and reads the
  refusal `GitHub · operator still reads <fleets>: connect them to another account first`;
  `--remove "Remove the token for org of GitHub · buser"` removes the token,
  and `--keep` keeps what it was asked to remove.

## Gotchas

- A fleet is registered as its manager: `drive-bb-plugins bb` without
  `--as <thread>` fails `no_thread`.
- Loading a fake's state replaces all of it. With no `logins` every token is
  `operator`'s; with `logins`, a token it does not list, a stored one
  included, is refused, and its fleets stop being watched.
- A change is read on the next poll, 2 minutes apart unless
  `fleet interval <repo> 30s`; date it a few seconds ahead of now, after the
  registration. A manager's turn ending reads its manifest at once.
- A comment is an echo only with the marker on a line of its own: a marker
  at the end of a sentence wakes the manager.
- A toast reaches only a window open when it is sent: a verb holds the page
  across the change. The rows a registration's manifest already holds raise
  no toast; only a row added later does.
- Every Answer, Grant or Build it starts a turn on the manager, which holds a
  session: `thread stop` it after.
- The queue's filter lives in the page and is dropped with it: every verb
  opens the page unfiltered. On a phone the board folds only past three
  fleets, so `--unfold` needs a fourth.
- Connect's `a new login` and Add account send no API address, so they reach
  the host typed into the popup, never a fake: type only a host under
  `.invalid`. A new account through a fake goes through the `connect` RPC.
- `Use your gh login` is disabled (`gh holds no login for this host.`): a run
  has no logged-in `gh` or `glab`.
- Make default moves every fleet that reads as the place's default, the ones
  Connect gave the default included, to the new default account; make the
  first one the default again before removing the other.
- An account a fleet reads as cannot be removed; the refusal names the
  fleets.
- A run started with Unattendish cannot be saved as a snapshot.
