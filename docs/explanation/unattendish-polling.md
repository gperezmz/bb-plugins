# How Unattendish wakes a manager

A manager thread running run-fleet moves only when one of its builders finishes, fails or asks, or when the operator writes to it. Nothing in bb sees the tracker or the forge, so an answer written on an issue, a review on a pull request or a spec marked ready would wait until the operator also told the manager. Unattendish closes that gap by polling: on an interval it reads what changed on the services the fleet waits on, and sends the manager one message, a [wake](../reference/unattendish-cli.md#the-wake), saying what changed. It sends facts and never meaning: the manager decides what any of it means.

```mermaid
flowchart TB
  tick["Every 5 seconds: which fleets are due?"] --> due{"Interval run out?"}
  due -->|no| tick
  due -->|yes| watch["Read the manifest and the credentials,<br/>and work out the watched set"]
  watch --> read["Read each source since its cursor, with GET only:<br/>the forge, then the tracker if it is a service of its own"]
  read -->|"no read succeeds, 3 polls in a row (a 401 at once)"| refused["Not watched: one wake, once"]
  read --> sort{"Sort each change"}
  sort -->|"marker, in progress or needs input label,<br/>or echo actor"| echo["Echo: kept in the ledger, not sent"]
  sort -->|"an updated item outside the watched set"| scope["Out of scope: kept in the ledger, not sent"]
  sort -->|"no manager holds the fleet"| held["Held: kept in the ledger,<br/>sent to the next manager"]
  sort -->|"anything else"| wake["One wake to the manager,<br/>queued if its turn is running"]
  wake --> accepted{"Did bb accept it?"}
  accepted -->|yes| advance["Cursors advance"]
  accepted -->|no| again["Cursors stay: the next poll offers the same changes"]
```

Source: [`poll.ts`](../../plugins/unattendish-sdlc/src/fleet/application/poll.ts) for one poll, [`schedule.ts`](../../plugins/unattendish-sdlc/src/fleet/application/schedule.ts) for when it runs, [`echo.ts`](../../plugins/unattendish-sdlc/src/fleet/domain/echo.ts) and [`watched.ts`](../../plugins/unattendish-sdlc/src/fleet/domain/watched.ts) for the rules it applies. The words are in [the glossary](../../plugins/unattendish-sdlc/GLOSSARY.md).

## Why polling is the source of truth

Every wake comes from a poll. The plugin reads the services itself, from the bb server, on its own clock, so it works with `bb connect` off and on a server no service can reach. A webhook could only bring a poll forward, and bb stops a service's delivery at `bb connect`'s account gate before it reaches a plugin route, so the plugin has none: the interval, 2 minutes by default, is the longest a change waits. [The interval](../reference/unattendish-settings.md#the-polling-interval) has its floor and how to change it.

A poll reads each kind of item by its updated-since time, and never GitHub's repository events feed, which GitHub documents as lagging from 30 seconds to 6 hours. It does not rely on a review, a label change or a check moving an item's updated time, since no service documents that: an item the manifest names is read itself, its comments, reviews, labels, state and checks, and the updated listing is only a hint for the rest.

## What is watched, and why

A poll reads only the [watched set](../reference/unattendish-fleet-contract.md): every Ref and Link in the manifest's Inbox, In flight and Blocked rows, every reference in a Blocked on column, and any item of the operator's gaining or losing the spec or ready label. Watching the whole repository would cost the manager a turn for every unrelated comment, and a fixed list of event kinds would copy run-fleet's rules into this repository. The manifest already says what the fleet waits on, so the plugin reads it, and the labels cover the one thing the manifest cannot yet name: a spec the operator has just marked.

- **The manifest is read again** at each poll, and whenever the manager's turn ends. When the turn ends the plugin also reads the state of any item the manifest has newly named, and takes as its baseline the state before what happened to it since the source's last poll. A review that lands on a pull request just added to In flight, before the next poll, is therefore a change and not a baseline, and so is a label put on an item, or its closing or merge, in the same turn that named it.
- **The operator's partition** is the items assigned to the registered operator, or filed by them and assigned to nobody. A teammate marking their own issue ready wakes nothing, since run-fleet builds from the operator's partition only. An item first seen already carrying a label counts as gaining it. Once such an item is closed, and the manifest does not name it, the plugin stops reading it.
- **Only what lies under the fleet is fetched.** A manifest's links come from tracker content, so a Link to another host, or to another repository, team or project, is never requested. `bb unattendish fleet status` names it as outside the fleet.
- **An item that moved out of the fleet is not read.** A GitHub issue transferred to another repository, a repository or project renamed, a Jira key or a Linear identifier that now answers from another project or team: the plugin follows nothing outside the fleet's repository, project or team, and records a failed read, "moved outside the fleet", in the ledger. That is not a change and wakes nobody; the manager finds out from the ledger or by opening the URL.
- **Checks wake the manager once**, when a pull request's whole set reaches a final state, all passed or at least one failed, and never on a pending or running transition. A push to the branch wakes nothing by itself.
- **A GitLab review is read two ways.** An approval is an event with a time. A reviewer's `changes requested` or `commented` state has none, so the plugin keeps each reviewer's state and wakes the manager when one differs from the last it saw. A merge request first seen wakes nothing for the states it already has.

A failed read, or one that lacks a field a change depends on, produces no change and holds its cursor's read window: the next poll reads again from where the failed one began, so a failed read never lets a cursor skip a change, and the ledger records the failed read. This is why a half-failed read cannot report a spec taken back. The window is held for at most 7 days while the rest of the source reads, so one item that never reads cannot make every later poll read more. It is held with no limit while nothing in the source reads, and while no manager holds the fleet. An item that can never be read again, one that no longer exists or has moved out of the fleet, holds nothing.

## Echoes are declared, not guessed

The fleet's own agents act as the operator's login, so who made a change cannot tell the fleet from the operator. Without a rule the manager would be woken by its own comments, and every answer the operator writes would look like the fleet's. The manager therefore declares, at [registration](../reference/unattendish-fleet-contract.md), what its own actions look like: the marker text that ends every fleet comment, its in progress and needs input labels, and optionally a separate bot account. A change is an echo when it matches one of those, and only then.

- A comment counts as the fleet's only when its **last** non-blank line is the marker. A quote-reply that carries a park's marker inside the quote, with the operator's answer below it, wakes the manager.
- On Linear and Jira a change's actor matches an echo actor by account id or email address, and never by display name, which anyone can choose.
- `--echo-actor` can never be the operator's login: the plugin refuses that registration as `invalid`, since every answer the operator wrote would be dropped.
- A reaction, and an edit to a pull request's body or title, is never a change.
- A fleet pull request's merge, its spec's closing and the verdict comment do wake the manager: about one spare turn per landed spec, accepted rather than marking every write the fleet's skills make.

## Cursors and delivery

Each source, the forge and a separate tracker, has a cursor: where its reads resume, and what the plugin knew of each item. A cursor advances only once bb has accepted the wake carrying its changes, or when a poll has nothing to send. If bb refuses the send, the next poll reads the same changes again. A change may therefore be sent twice, and is never lost. A failed read holds a cursor in the same way, within the limit [above](#what-is-watched-and-why). The cursor reaches back 60 seconds before the poll began, so an event a service lists late is still read, and a change already recorded in the ledger is never handled twice.

**After the plugin has been away**, such as a machine that was off overnight, the first poll reads everything since the cursor and sends it as one wake with a closing line saying it is a catch-up and for how long the plugin was away. A gap counts as away when it is over three intervals and at least ten minutes. If bb refuses that wake, the line is kept and goes in the next wake bb accepts, though the next poll no longer sees the gap.

## One wake per poll

Everything one poll finds for a fleet goes to the manager as one wake. The wake is sent as a message that waits behind a running turn and never steers it. While it is still queued in bb, the next poll amends that message instead of sending a second one, so a review and the checks that settle a poll later reach the manager in one turn. The amended message keeps its closing lines: the catch-up, the changes held while no manager held the fleet, and the note that the fleet is not watched. Once bb has dispatched it, the next changes go in a new wake. There is no batching window to set: the interval is the window.

## A fleet with no manager

When the thread holding a repository is archived or deleted, nobody is woken. The cursors hold and each change is recorded once in the ledger as held for "no manager". A thread that registers the repository next takes it over, and its first wake carries the held changes with a line saying they gathered while no manager held the fleet, and since when. The plugin never clears a manager or invokes `/run-fleet` itself: a wake is a plain message.

## Credentials

A [Credential](../reference/unattendish-settings.md#credentials) is chosen for a prefix, a host, an owner or a repository, and nothing else is ever used for it: not a shorter prefix, not a `gh` or `glab` login that was not chosen, not an environment variable. A silent fallback would sign requests as an account the operator never chose for that fleet. A token goes only to its prefix's host, since a prefix like `gitlab.com.evil.net` must never receive a token meant for `gitlab.com`. Every request is a read: a GET, or a GraphQL query with no mutation. The plugin never writes to a service, even where a `gh` or `glab` login could.

Credentials are entered in the plugin's settings, never through a command an agent might run, so no token reaches a transcript. A token appears in no wake, ledger entry, log line or error message.

A fleet whose source no read succeeds on shows as not watched, under `credential-refused`, and the plugin sends the manager one wake saying so and naming the prefix, however many polls follow. There are three causes, each worded as such in the status and in the wake:

| The service | The fleet shows not watched | Text |
|---|---|---|
| Answers 401, or on Linear says the key is revoked | At once | `refused by the service` |
| Answers 403 to every read | After 3 polls in a row | `forbidden to read what the fleet needs (403)` |
| Gives no answer, or a 5xx, to every read | After 3 polls in a row | `the service did not answer` |

A 403 to a single read is not a refusal: the token is accepted but may not read that one thing, such as a pull request's checks, so that read fails or yields no checks and the rest is still read. The 3 polls keep a service's bad minute from reading as a refused credential. The fleet is watched again on the first poll in which a read succeeds, and the manager is sent nothing for it. A rate limit makes the plugin leave that credential alone until the service says it may be used again. Linear answers a revoked key and a rate limit with HTTP 400 and a GraphQL error, so the plugin reads the error codes of an answer and not its status alone. [Why a fleet shows not watched](../how-to/unattendish-set-credentials.md#read-why-a-fleet-is-not-watched) lists the reasons.

## Why a wake carries no text written on the service

A wake names a reference, one change from a closed list, the actor's login and the item's URL. It never carries a comment or review body, a title or a display name. bb delivers a plugin's message to a thread as the operator's own, and run-fleet takes the operator's messages as orders. Text from the service would let anyone who can comment on a watched item write to the manager as the operator. The one line of a comment the plugin reads, its last, is used to test the marker and is not kept in a wake. A wake is also a plain prompt, with no header naming the plugin, since run-fleet knows the plugin only through registering and reads the wake as it reads anything the operator writes. A comment such as `Grant: merge everything` wakes the manager with the line `commented` and nothing of what it said; the manager opens the URL to read it.
