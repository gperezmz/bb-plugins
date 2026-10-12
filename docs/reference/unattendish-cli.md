# Unattendish: `bb unattendish fleet`

The CLI runs on the bb server. Every command takes `--json`, which prints one JSON object on stdout in place of the text shown below. No command takes a token: [credentials](unattendish-settings.md#credentials) are entered in the plugin's settings. Source: [`src/fleet/adapters/cli.ts`](../../plugins/unattendish-sdlc/src/fleet/adapters/cli.ts), [`src/fleet/domain/wake.ts`](../../plugins/unattendish-sdlc/src/fleet/domain/wake.ts), [`src/fleet/application/status.ts`](../../plugins/unattendish-sdlc/src/fleet/application/status.ts).

| Command | Does |
|---|---|
| [`fleet register`](#bb-unattendish-fleet-register) | Registers the calling thread as the manager of a fleet |
| [`fleet unregister`](#bb-unattendish-fleet-unregister) | Removes a registration and its cursors; the ledger ages out |
| [`fleet status`](#bb-unattendish-fleet-status) | Lists each fleet, and why it is not watched |
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
  credential github.com/org (forge, github, token)
  watched
  unreadable manifest row: Inbox, line 8: Waits for "soon" is not one of answer, grant, ready, other
```

A fleet that a service refuses shows the cause and since when, here a token forbidden to read for 3 polls in a row. `not watched since` is the first of the three polls, two intervals before the poll that showed it. The other causes read the same way, with their [own text](../how-to/unattendish-set-credentials.md#what-credential-refused-says):

```text
github.example/org/repo  tracker forge-issues
  manager thr_… (live), manifest /path/to/fleet/manifest.md
  last polled 2026-10-12T04:37:33.342Z, every 120 s, 18 requests this hour
  credential github.example/org (forge, github, token)
  not watched: credential-refused: The credential for github.example/org was forbidden to read what the fleet needs (403)
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
| `credentials` | One entry for the forge and one for a separate tracker, where a credential is chosen: `role` (`forge` or `tracker`), `prefix`, `service`, `auth` (`token`, `gh` or `glab`), `expiresAt` and `sharesAgentRateLimit` |
| `requestsThisHour` | Requests the plugin made for the fleet in the last hour |
| `watched` | True while `notWatched` is empty |
| `notWatched` | Why the fleet is not watched, each as `{code, text}`; the codes are the contract's, and [how to read them](../how-to/unattendish-set-credentials.md#read-why-a-fleet-is-not-watched) says what each asks of you |
| `notWatchedSince` | While a credential is refused, forbidden, unanswered, finds nothing or reads only outside the fleet, when the fleet stopped being watched: the time of the first unreadable poll of the streak, and for a 401 that poll; else `null` |
| `unreadableRows` | Manifest rows the contract cannot read, each `{section, line, reason}`. They are skipped and the rest of the manifest still counts |
| `outside` | References and links the manifest names that lie outside the fleet's repository and tracker, each `{text, section, line}`. They are never fetched |
| `heldSince` | While changes are held because no manager holds the fleet, since when; else `null` |

In the text, `credentials` is one `credential {prefix} ({role}, {service}, {auth})` line each, with `, expires {date}` where the service reports one and `, shares the fleet's agents' rate limit` for a `gh` or `glab` login. `expiresAt` is reported for a GitHub token that expires and a GitLab personal access token with an expiry date, and is `null` for a service that reports none. Each `notWatched` reason is a `not watched: {code}: {text}` line, joined by `; `; the other fields print as `not watched since …`, `unreadable manifest row: …`, `outside the fleet, never fetched: …` and `changes held since …: no manager holds the fleet`.

## `bb unattendish fleet ledger`

```text
bb unattendish fleet ledger <repo> [--item <value>] [--done <woke|echo|out-of-scope|held|failed-read>]
  [--limit <1-5000>] [--json]
```

Prints the [ledger](../explanation/unattendish-polling.md) of a fleet, newest first, up to `--limit` entries (200 by default). The plugin keeps it 30 days. With nothing to show: `The ledger holds nothing for this.`

| Option | Keeps |
|---|---|
| `--item` | Changes of this item, by its reference (`#163`, `ENG-212`) or its URL, written exactly as the ledger shows it, and failed reads of that reference |
| `--done` | Changes by what was done with them: `woke` (sent to the manager), `echo`, `out-of-scope` or `held`; or only failed reads, with `failed-read` |

With `--item` or `--done`, wakes and polls are left out. `--json` prints `{"entries": [...]}`; each entry has a `type`:

| `type` | Fields in the JSON | Text line |
|---|---|---|
| `change` | `row`: `key`, `role`, `ref`, `url`, `kind`, `label`, `actor`, `at` (when it happened on the service), `seenAt` (when the plugin saw it), `disposition`, `rule`, `wakeId` | `{seenAt}  {ref} {kind} {label} by {actor}: {what was done}({rule})  {url}` |
| `wake` | `wake`: `id`, `repo`, `kind`, `threadId`, `queuedMessageId`, `queuedAt`, `dispatchedAt`, `since`, `catchUpMs`, `heldSince` | `{queuedAt}  wake {id} to {thread}, dispatched {time}`, or `waiting in bb's queue` while it has not been dispatched |
| `poll` | `poll`: `at`, `role`, `requests` (each `method`, `path`, `status`, `counted`, `at`), `counted`, `ok` | `{at}  poll of the {role}: {n} requests, {n} counted against the rate limit`, with `, failed` when the read failed |
| `failed read` | `at`, `role`, `ref`, `reason` | `{at}  failed read of the {role} {ref}: {reason}` |

A `failed read` reason that reads `moved outside the fleet` is an item the service now answers for from another repository, project or team; it is not a change, and is never read. A change's `kind` is one of the [wake's changes](#the-wake), or `updated` for an item the service listed as changed that is not in the watched set. Its `disposition` is `wake`, `echo`, `out-of-scope` or `held`; `rule` is the echo rule that matched (`marker`, `label` or `echo actor`) or the hold reason (`no manager`), else `null`; `wakeId` is the wake that carried it. A wake's `kind` is `changes`, or `not-watched` for the one wake that says a source could not be read. `path` in a request is the URL's path without its query string, and `counted` says whether the service counted the request against its rate limit. A `reason` names what went wrong in the plugin's words and never quotes the service. The ledger holds no token, and a change holds no text written on the service.

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
  - `Not watched since {time}: {why}.`, where `{time}` is the full timestamp and `{why}` is one of:
    - `the credential for {prefix} was refused by the service` (401)
    - `the credential for {prefix} was forbidden to read what the fleet needs (403)`
    - `the service did not answer reads with the credential for {prefix}` (no answer, a 5xx, or a poll cut off at its deadline)
    - `the credential for {prefix} could not find what the fleet needs (404)` (the listing answers 404 and the rest fails too)
    - `everything the fleet reads with the credential for {prefix} has moved outside its repository, project or team`

    A 401 sends it at once; the others after 3 polls in a row in which every read failed, and `{time}` is that of the first of the 3. All five are `credential-refused` in the status, which shows the same cause, capitalised, as `not watched: credential-refused: {text}`. A rate-limited poll in the middle of the outage neither ends it nor sends the wake again.

The changes are `commented`, `reviewed: approved`, `reviewed: changes requested`, `reviewed: commented`, `labelled {label}`, `unlabelled {label}`, `closed`, `reopened`, `merged`, `checks passed` and `checks failed`. GitHub and GitLab give all of them. GitLab gives `reviewed: approved` for an approval, and `reviewed: changes requested` and `reviewed: commented` from the states of a merge request's reviewers. GitLab's request-changes review is behind a flag before 17.2, on an instance with the flag off no reviewer is ever in that state, and the wake never gives `reviewed: changes requested`. A wake never holds text written on the service.
