# Unattendish: `bb unattendish fleet`

The CLI runs on the bb server. Every command takes `--json`, which prints one JSON object on stdout in place of the text shown below. No command takes a token: [accounts and their tokens](unattendish-settings.md#accounts) are added through **Connect…** and the plugin's settings section, as [connect a fleet to an account](../how-to/unattendish-connect-a-fleet.md) shows. Source: [`src/fleet/adapters/cli.ts`](../../plugins/unattendish-sdlc/src/fleet/adapters/cli.ts), [`src/fleet/domain/wake.ts`](../../plugins/unattendish-sdlc/src/fleet/domain/wake.ts), [`src/fleet/application/status.ts`](../../plugins/unattendish-sdlc/src/fleet/application/status.ts).

| Command | Does |
|---|---|
| [`fleet register`](#bb-unattendish-fleet-register) | Registers the calling thread as the manager of a fleet |
| [`fleet unregister`](#bb-unattendish-fleet-unregister) | Removes a registration and its cursors; the ledger ages out |
| [`fleet status`](#bb-unattendish-fleet-status) | Lists each fleet, the account each half reads as, and why it is not watched |
| [`fleet ledger`](#bb-unattendish-fleet-ledger) | Prints what the plugin saw and what it did with it |
| [`fleet interval`](#bb-unattendish-fleet-interval) | Sets how often a fleet is polled |

A fleet is named by its repository, `<host>/<path>` as the manifest's first line spells it, matched without regard to case.

## Exit behaviour and error codes

A command that does what it was asked exits 0. Anything else exits non-zero, with the message on stderr, or, under `--json`, bb's error envelope `{"ok": false, "error": {"code": …}}` on stdout. `register` is the exception: [every outcome](unattendish-fleet-contract.md), refused ones included, exits 0.

| Code | From | When |
|---|---|---|
| `no_thread` | `register` | The command was not run from a thread. A manager runs it from its own thread |
| `interval_too_short` | `interval` | The interval is under 30 seconds. The hint names the floor |
| `not_registered` | `interval` | No fleet holds the repository |
| `invalid_value` | `unregister`, `ledger`, `interval` | The repository is not `<host>/<path>`, or the interval is neither `default` nor a duration such as `30s`, `2m` or `1h` |

A required option left out, an option given twice, and a value outside an option's range or choices exit 1 with bb's usage message.

## `bb unattendish fleet register`

```text
bb unattendish fleet register --contract <0-1000000> --repo <host/path>
  --tracker <forge-issues|linear:<team>|jira:<site>/<project>> --manifest <path>
  --operator <value> --label-spec <value> --label-ready <value>
  --label-in-progress <value> --label-needs-input <value> --marker <value>
  [--echo-actor <value>]... [--json]
```

Run by a manager from its own thread, on every `/run-fleet`. Every option except `--echo-actor` and `--json` is required; `--echo-actor` may be repeated. What each option means, the five outcomes and what each carries are [the contract](unattendish-fleet-contract.md), which is their one authority. This page adds how they print.

| Outcome | Text |
|---|---|
| `registered` | `Registered (watched)`, or `Registered (not fully watched: {reasons})` with each reason's text, separated by `; ` |
| `taken-over` | `Registered, taking the fleet over from {previous manager} (watched)`, or with `not fully watched: …` as above |
| `refused` | `Refused: thread {holder} holds this repository` |
| `unsupported` | `Unsupported contract version; this plugin speaks 1` |
| `invalid` | `Invalid: {reason}` |

Registering a repository the calling thread already holds replaces the registration with the new arguments and keeps its interval, cursors and ledger. A registration changes nothing when it is `refused`, `unsupported` or `invalid`.

## `bb unattendish fleet unregister`

```text
bb unattendish fleet unregister <repo> [--json]
```

Removes the registration and its cursors. The ledger stays and ages out after 30 days, so `fleet ledger` still shows what the plugin did. It prints `Unregistered.`, or `No fleet is registered for that repository.` and still exits 0. With `--json`: `{"outcome": "unregistered"}` or `{"outcome": "not-registered"}`.

## `bb unattendish fleet status`

```text
bb unattendish fleet status [--json]
```

Lists every fleet. With none: `No fleet is registered.` For each, in this order, with a line left out where it has nothing to say:

```text
github.com/org/repo  tracker forge-issues
  manager thr_… (live), manifest /path/to/fleet/manifest.md
  last polled 2026-10-12T02:22:28.877Z, every 120 s, 8 requests this hour
  forge reads as GitHub · yuser
  credential GitHub · yuser for org (forge, github, token)
  watched
  unreadable manifest row: Inbox, line 8: Waits for "soon" is not one of answer, grant, ready, other
```

Each half of the fleet, its `forge` and a `tracker` of its own, says which account it reads as. A half that no account reads says what it needs, and the fleet is not watched with `no-credential`:

```text
github.com/other-org/x  tracker forge-issues
  manager thr_… (live), manifest /path/to/fleet/manifest.md
  last polled never, every 120 s, 0 requests this hour
  forge reads as no account: other-org/x needs a GitHub account that can read other-org
  not watched: no-credential: other-org/x needs a GitHub account that can read other-org
```

A half whose account holds a login that cannot give a token reads as that account and says why: `forge reads as GitHub · buser: gh is signed in as yuser, not buser`. Connect the half again from its card, or from the **Waits on you** entry.

A fleet that a service refuses shows the cause and since when, here a token forbidden to read for 3 polls in a row. A fleet whose listing of what changed keeps failing shows it the same way, as `not watched: credential-refused: The service keeps failing to list what changed with the credential for GitHub · yuser for org`. `not watched since` is the first of the three polls, two intervals before the poll that showed it. The other causes read the same way, with their [own text](../how-to/unattendish-connect-a-fleet.md#what-credential-refused-says):

```text
github.example/org/repo  tracker forge-issues
  manager thr_… (live), manifest /path/to/fleet/manifest.md
  last polled 2026-10-12T04:37:33.342Z, every 120 s, 18 requests this hour
  forge reads as GitHub · yuser
  credential GitHub · yuser for org (forge, github, token)
  not watched: credential-refused: The credential for GitHub · yuser for org was forbidden to read what the fleet needs (403)
  not watched since 2026-10-12T04:33:33.342Z
```

`--json` prints `{"fleets": [...]}`, one object per fleet with these fields:

| Field | Meaning |
|---|---|
| `repo`, `tracker` | The repository, and the tracker as `forge-issues`, `linear:<team>` or `jira:<site>/<project>` |
| `manager`, `managerState` | The manager's thread id, and `live`, `archived` or `gone` |
| `manifest` | The manifest's absolute path |
| `lastPolledAt` | When the fleet was last polled, or `null` before its first poll. Text: `never` |
| `intervalMs` | The poll interval in milliseconds, the default 120000 until [set](#bb-unattendish-fleet-interval) |
| `accounts` | One entry for the forge and one for a separate tracker: `role` (`forge` or `tracker`), `account` (`GitHub · yuser`, or `null` where no account reads the half) and `needs` (what the half needs, or `null` while it reads) |
| `credentials` | One entry for the forge and one for a separate tracker, where an account has a credential that reads it: `role`, `credential` (`GitHub · yuser for acme`), `account`, `service`, `kind` (`fine-grained`, `classic`, `gitlab-token`, `linear-key`, `jira-token`, `gh` or `glab`), `auth` (`token`, `gh` or `glab`), `expiresAt`, `canWrite` and `sharesAgentRateLimit` |
| `requestsThisHour` | Requests the plugin made for the fleet in the last hour |
| `watched` | True while `notWatched` is empty |
| `notWatched` | Why the fleet is not watched, each as `{code, text}`; the codes are the contract's, and [how to read them](../how-to/unattendish-connect-a-fleet.md#read-why-a-fleet-is-not-watched) says what each asks of you |
| `notWatchedSince` | While a credential is refused, forbidden, unanswered, finds nothing, reads only outside the fleet or its listing keeps failing, when the fleet stopped being watched: the time of the first unreadable poll of the streak, and for a 401 that poll; with an outage in both sources, the earlier; else `null` |
| `unreadableRows` | Manifest rows the contract cannot read, each `{section, line, reason}`. They are skipped and the rest of the manifest still counts |
| `outside` | References and links the manifest names that lie outside the fleet's repository and tracker, each `{text, section, line}`. They are never fetched |
| `heldSince` | While changes are held because no manager holds the fleet, since when; else `null` |

In the text, `accounts` is one `{role} reads as {account}` line each, ending in `: {needs}` where the half needs something, and `credentials` is one `credential {credential} ({role}, {service}, {auth})` line each, with `, expires {date}` where the service reports one, `, can write` for a classic token or a `gh` or `glab` login, and `, shares the fleet's agents' rate limit` for a `gh` or `glab` login. `expiresAt` is reported for a GitHub token that expires and a GitLab personal access token with an expiry date, and is `null` for a service that reports none. Each `notWatched` reason is a `not watched: {code}: {text}` line, joined by `; `; the other fields print as `not watched since …`, `unreadable manifest row: …`, `outside the fleet, never fetched: …` and `changes held since …: no manager holds the fleet`.

## `bb unattendish fleet ledger`

```text
bb unattendish fleet ledger <repo> [--item <value>] [--done <woke|echo|out-of-scope|held|failed-read|skipped-listing>]
  [--limit <1-250>] [--json]
```

Prints the [ledger](../explanation/unattendish-polling.md) of a fleet, newest first, up to `--limit` entries (200 by default, 250 at most: bb refuses a command that prints more than 1 MiB, and a higher value is refused with an error naming the cap). To stay within that, a string longer than 200 characters is cut and ends in `…`, and a poll lists its first 5 requests, with `requestsOmitted` in the JSON for the rest; the poll's `counted` and the text's request count stay whole, and the ledger itself holds everything. The plugin keeps it 30 days. With nothing to show: `The ledger holds nothing for this.`

| Option | Keeps |
|---|---|
| `--item` | Changes of this item, by its reference (`#163`, `ENG-212`) or its URL, written exactly as the ledger shows it, and failed reads of that reference |
| `--done` | Changes by what was done with them: `woke` (sent to the manager), `echo`, `out-of-scope` or `held`; or only failed reads, with `failed-read`; or only the Dropped entries that Skipped listings wrote, with `skipped-listing`, which `out-of-scope` keeps too. With `skipped-listing` and `--item` the ledger holds nothing, since a Skipped listing names no item |

With `--item` or `--done`, wakes and polls are left out. `--json` prints `{"entries": [...]}`; each entry has a `type`:

| `type` | Fields in the JSON | Text line |
|---|---|---|
| `change` | `row`: `key`, `role`, `ref`, `url`, `kind`, `label`, `actor`, `at` (when it happened on the service), `seenAt` (when the plugin saw it), `disposition`, `rule`, `wakeId` | `{seenAt}  {ref} {kind} {label} by {actor}: {what was done}({rule})  {url}` |
| `wake` | `wake`: `id`, `repo`, `kind`, `threadId`, `queuedMessageId`, `queuedAt`, `dispatchedAt`, `since`, `catchUpMs`, `heldSince` | `{queuedAt}  wake {id} to {thread}, dispatched {time}`, or `waiting in bb's queue` while it has not been dispatched |
| `poll` | `poll`: `at`, `role`, `requests` (the first 5; each `method`, `path`, `status`, `counted`), `requestsOmitted` (how many more, when there are), `counted`, `ok` | `{at}  poll of the {role}: {n} requests, {n} counted against the rate limit`, with `, failed` when the read failed |
| `change` (a cut-off listing) | `row` as above, with `ref` and `url` `null`, `kind` `skipped listing`, `actor` `null`, `at` the last update the listing reached, `rule` `listing cut at its page limit`, and `window`: `from` and `to`, the window it listed | `{seenAt}  out of scope: listing cut at its page limit  listed {from} to {to}, reached {at}` |
| `failed read` | `at`, `role`, `ref`, `reason` | `{at}  failed read of the {role} {ref}: {reason}` |

A Jira poll whose updated listing is cut off at its page limit without getting past the cursor, as a bulk edit in Jira makes it, writes one such `change` with `disposition` `out-of-scope`, and no `failed read`: the out-of-scope rows of the issues past the page limit are not recorded, and the dashboard's Ledger groups these entries under `out of scope: listing cut at its page limit`. A `failed read` reason that reads `moved outside the fleet` is an item the service now answers for from another repository, project or team; it is not a change, and is never read. A change's `kind` is one of the [wake's changes](#the-wake), `updated` for an item the service listed as changed that is not in the watched set, or `skipped listing` for the entry above. Its `disposition` is `wake`, `echo`, `out-of-scope` or `held`; `rule` is the echo rule that matched (`marker`, `label` or `echo actor`) the hold reason (`no manager`), or `listing cut at its page limit` on that entry, else `null`; `wakeId` is the wake that carried it. A wake's `kind` is `changes`, or `not-watched` for the one wake that says a source could not be read. `path` in a request is the URL's path without its query string, and `counted` says whether the service counted the request against its rate limit. A `reason` names what went wrong in the plugin's words and never quotes the service. The ledger holds no token, and a change holds no text written on the service.

## `bb unattendish fleet interval`

```text
bb unattendish fleet interval <repo> <interval> [--json]
```

Sets how often the fleet is polled. `<interval>` is a number and a unit, `ms`, `s`, `m` or `h`, such as `45s`, `2m` or `1h`, or `default` to go back to 2 minutes. The floor is 30 seconds: a shorter interval exits non-zero as `interval_too_short`. It prints `Polling every {interval}.` or `Back to the default interval.`; with `--json`, `{"outcome": "interval-set", "intervalMs": 60000}`, where `intervalMs` is `null` for `default`. The new interval applies from the fleet's next poll.

## The wake

A message to the manager, sent as a plain message in the operator's voice that waits behind a running turn. It names no plugin: run-fleet reads it as it reads anything the operator writes, so it is not part of [the contract](unattendish-fleet-contract.md), which is only the register call and the manifest. This section is the one place that shows the exact text the plugin builds.

```text
Moved on the tracker or the forge since 2026-10-12 02:22 UTC:
#7 commented by alice https://github.com/org/repo/issues/7
#12 reviewed: approved by bob https://github.com/org/repo/pull/12
Catch-up: the plugin was away for 8h 12m.
```

- **First line**: `Moved on the tracker or the forge since {time}:`, with the time the changes run from to the minute, such as `2026-10-12 14:02 UTC`. A wake with no changes, the one that says a source is not watched, reads `Nothing moved on the tracker or the forge since {time}.`
- **One line per change**: `{reference} {change} by {actor} {URL}`, in time order. The reference is `#163`, `!45` (a GitLab merge request), `ENG-212` or `PROJ-12`. The actor is a login or account id; a reference, actor or URL that does not pass the plugin's strict test prints as `unknown`.
- **Closing lines**, each only where it applies:
  - `Gathered while no manager held the fleet, since {time}.`
  - `Catch-up: the plugin was away for {duration}.` with the two largest units of days, hours, minutes and seconds, such as `3d 2h`, `8h 12m` or `45s`.
  - `Not watched since {time}: {why}.`, where `{time}` is the full timestamp and `{why}` is one of, with `{credential}` the credential's label, such as `GitHub · yuser for acme` (a GitHub token names its owner):
    - `the credential for {credential} was refused by the service` (401)
    - `the credential for {credential} was forbidden to read what the fleet needs (403)`
    - `the service did not answer reads with the credential for {credential}` (no answer, a 5xx, or a poll cut off at its deadline)
    - `the credential for {credential} could not find what the fleet needs (404)` (the listing answers 404 and the rest fails too)
    - `everything the fleet reads with the credential for {credential} has moved outside its repository, project or team`
    - `the service keeps failing to list what changed with the credential for {credential}` (the items read, and the listing fails by itself: an error on the listing alone, the partition listing past the page limit, or a cut-off that cannot move the cursor, which on Jira is a listing whose times did not run oldest first)

    A 401 sends it at once; the others after 3 polls in a row in which every read failed, or in which the listing failed, and `{time}` is that of the first of the 3. All six are `credential-refused` in the status, which shows the same cause, capitalised, as `not watched: credential-refused: {text}`. The status also reports under `credential-refused` a credential the service accepts but that cannot read the fleet's repository, tracker team or project, which Connect found and keeps until a read succeeds; it is not one of the six, and [the how-to](../how-to/unattendish-connect-a-fleet.md#what-credential-refused-says) words it. An outage is kept per source, the forge and a tracker of its own, and a wake names one source's: two sources refused at once take two wakes, the forge's first. A rate-limited poll in the middle of an outage neither ends it nor sends the wake again.

    A wake that carries only this line reads, for the listing that keeps failing:

    ```text
    Nothing moved on the tracker or the forge since 2026-10-12 10:00 UTC.
    Not watched since 2026-10-12T10:00:00.000Z: the service keeps failing to list what changed with the credential for GitHub · yuser for org.
    ```

The changes are `commented`, `reviewed: approved`, `reviewed: changes requested`, `reviewed: commented`, `labelled {label}`, `unlabelled {label}`, `closed`, `reopened` and `merged`. The plugin reads no CI, so no change reports a check, a commit status or a pipeline. GitHub and GitLab give all of them. GitLab gives `reviewed: approved` for an approval, and `reviewed: changes requested` and `reviewed: commented` from the states of a merge request's reviewers. GitLab's request-changes review is behind a flag before 17.2, on an instance with the flag off no reviewer is ever in that state, and the wake never gives `reviewed: changes requested`. A wake never holds text written on the service.
