# Unattendish

Wakes the manager thread of an Unattendish fleet when the tracker or forge it
waits on changes, and shows the operator their fleets: a Fleets page with
everything that waits on them, a card per fleet and what landed this week; a
Fleet chip and a Fleet tab on each manager thread; a toast for a new Inbox
row and for a fleet no account can read; a Connect… popup that verifies a
read-only token before storing it; and a settings section for accounts and
poll intervals. Answer…, Grant… and Build it send the manager one plain
message, and the plugin writes nothing to a tracker. A manager registers its
fleet with `bb unattendish fleet register`, from its own thread.

## Sub-features

- `page`: the Fleets page: its count, Waits on you, Needs an account,
  Recently sent, the cards and Recently landed.
- `card`: a fleet's card: tracker, manager, counts, cost, last poll, the
  account each half reads as, and what stops it being watched.
- `actions`: Answer…, Grant… and Build it on an Inbox row, then `sent`,
  `done` or `not sent`.
- `chip`: the Fleet chip in a manager's header, and the card it opens on
  hover.
- `tab`: the Fleet tab, and its Ledger.
- `toasts`: the new-Inbox-row toast and the needs-an-account toast.
- `connect`: the Connect… popup: Connect, Add a token, Renew a token, Add
  account.
- `settings`: accounts, their tokens, the default, and each fleet's poll
  interval.
- `cli`: `bb unattendish fleet register|unregister|status|ledger|interval`,
  and the wake a manager receives.

## How to get to it (user POV)

- `navigation "Primary navigation"` → `button "Fleets"`: the page, at
  `/plugins/unattendish-sdlc/fleets`, its header count `N waiting on you`.
  `region "Waits on you N"` holds a `table` (columns `Fleet`, `What`,
  `Waits for`, `Waiting`, `Item`, `Action`; Waits for reads `your answer`,
  `a grant to merge`, `your ready label` or `something else`), one row per
  Inbox row and one per unreadable row (`unreadable: <why> (line N)`,
  `button "Open the Fleet tab of <repo>"`); on a phone a stacked list
  (`waits for your answer · 11h 56m`). Then `list "Needs an account"`,
  `list "Recently sent"` (`<repo> answered #7 · done`), `region "Fleets"`
  with an `article "Fleet <repo>"` each, and
  `region "Recently landed last 7 days, all fleets"`.
- A card: `button "Open the Fleet tab of <repo>"` (`manager ↗`),
  `forge-issues · manager idle 12s` (or `no manager`),
  `5 waits on you · 1 in flight · 1 landed today`, with Thread Usage
  installed `$0.17 since this manager started`, `polled 8s ago`,
  `list "Accounts of <repo>"` (`forge org/dash · reads as GitHub · operator`
  and `button "Change account… forge of <repo>"`, or the need and
  `button "Connect… forge of <repo>"`), and `1 manifest row cannot be read`
  with `button "Open the Fleet tab"`.
- An Inbox row's action: `button "Answer… #7"`, `"Grant… #8"` or
  `"Build it #9"`; Answer and Grant open, in a row of their own under it,
  `textbox "Your answer for #7"` (`Your grant for`), `button "Send"`
  (disabled while empty) and `button "Cancel"`; Control+Enter sends, Escape
  cancels. The Action cell then reads `sent · 0s`, or `not sent` with bb's
  refusal (`HTTP 409: Thread is archived`).
- A manager's thread, at `/projects/<project>/threads/<thread>`:
  `button "Fleet: 5 waits on you · 1 in flight · 1 landed today"` in the
  header (`Fleet idle` with nothing), whose hover opens the card and whose
  click opens the `Fleet` tab. On a phone the chip's text is the count alone.
- The Fleet tab: the card, then `region`s `Waits on you` (the table, without
  the Fleet column), `In flight`, `Blocked`, `Landed last 7 days`, one for
  each other section the manifest writes (`Backlog`),
  `Unreadable rows in <repo>'s manifest`, `Watched set (N items)`,
  `Credentials`, `Polling` (`every 30s · polled 12s ago · 24 requests this hour`)
  and `button "Ledger ▸"`, which opens `group "What was done"` (`All`,
  `Woke`, `Dropped`, `Held`, `Failed reads`, `Wakes`),
  `textbox "Filter by item"`, and the entries (`Dropped, by reason`,
  `echo: marker · 1`; `Nothing in the ledger matches.`).
- Toasts, in every open window: `<repo> waits on you — #15 <What>` with
  `Open Fleets`; `<repo> needs a GitHub account that can read <owner>` with
  `Connect…`, which opens the popup.
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
for the card's cost. `start` runs the fake GitHub, GitLab, Linear and Jira
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
  prints `shown` (`count`, `sections`, `rows`, `needsAnAccount`,
  `recentlySent`, `cards`, `landed`) and `stored`, the `fleets` RPC;
  `--open-tab <repo>` presses the card's `manager ↗` and prints the Fleet tab
  it lands on; `--mobile` reads the stacked list.
- **Actions** (`unattendish.actions/page`):
  `unattendish-sdlc act "Answer…" '#7' 'Go with B.\nIt is simpler.'`
  prints the composer (`sendEnabledEmpty` false) and the row after
  (`sent · 0s`), and `$A` receives `Answer to #7: Go with B.` and
  `It is simpler.`; `act "Grant…" '#8' 'Merge it.'` sends
  `Grant: Merge it.`, and `act "Build it" '#9'` sends `Build #9`. `--esc`
  cancels, sending nothing. Once the manifest no longer holds the row, the
  next poll reads it `done` in `recentlySent`. With the manager archived,
  `act … --wait "not sent"` reads `not sent` and `HTTP 409: Thread is archived`.
- **Chip** (`unattendish.chip/header`): `unattendish-sdlc chip $A --hover`
  prints the chip's `name` and the card its hover opens; `--open` reads the
  tab; `--mobile` reads `text` as the count alone.
- **Tab and ledger** (`unattendish.tab/panel`):
  `unattendish-sdlc fleets-page --open-tab <repo>` prints every section;
  `unattendish-sdlc ledger $A --filter Dropped --item '#8'` opens the Ledger
  and lists `echo: marker · 1` once a comment ending in the marker, on a line
  of its own, has been polled.
- **Toasts** (`unattendish.toasts/ws`): `unattendish-sdlc toast <trigger.sh> --click "Open Fleets"`
  holds the Fleets page open while the script adds an Inbox row to the
  manifest and runs `thread tell $A hi`, `thread wait $A --status idle` and
  `thread stop $A`, then prints the toast. A trigger that registers a fleet
  on `github.example/other-org/x` raises
  `other-org/x needs a GitHub account that can read other-org`;
  `--click "Connect…"` opens the popup on it.
- **Connect** (`unattendish.connect/card`):
  `unattendish-sdlc connect "Connect… forge of github.example/other-org/x" --account "GitHub · operator" --token ghp_connect_fake_token`
  prints each step, `createTokenUrl` and the result, and `status` has the
  fleet `watched`. `--from settings` starts on the settings page:
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
