# Unattendish

The plugin that wakes the manager thread of an Unattendish fleet when the tracker or forge the fleet waits on changes, shows the operator what waits on them across fleets, and the words it shares with the run-fleet skill.

## Language

### The fleet

**Fleet**:
One repository's specs being built by a manager and its builders, as run-fleet runs it.
_Avoid_: Swarm, campaign

**Manager**:
The thread that runs run-fleet for one repository and is registered with the plugin. At most one live thread holds a repository.
_Avoid_: Orchestrator, coordinator, supervisor

**Builder**:
A child thread of a manager building one spec.
_Avoid_: Implementer

**Manifest**:
The manager's file that holds the fleet in one place; its Inbox, In flight and Blocked rows say what the plugin watches.
_Avoid_: Fleet file, state file

### What the plugin keeps

**Registration**:
The plugin's record that a manager thread holds a repository, with what it registered: the tracker, the manifest path, the operator, the labels, the marker and the echo actors.
_Avoid_: Subscription, enrolment

**Ledger**:
The plugin's record of every change it saw and what it did with it, kept for 30 days.
_Avoid_: Audit trail

**Account**:
One login on one host or service, whose credentials the plugin reads as. Two logins on one host are two accounts.
_Avoid_: Identity, profile

An account's service, host or site, and API address are fixed once it is added, and its login is read from its first token rather than typed.

**Half**:
One of the two things a fleet reads: its forge, or its tracker where that is a service of its own. Each half reads as one account, and Connect fixes one half at a time.
_Avoid_: Side

**Place**:
Where an account lives: a forge's host, a Jira site, or Linear. An assignment and a default name an account on their own place only.
_Avoid_: Realm

**Credential**:
A token, or a chosen `gh` or `glab` login, belonging to one account, and the owner or host it reaches.
_Avoid_: Auth entry

**Assignment**:
Which account reads a host or an owner or group (on Linear, every team or one team; on Jira, a site or a project). The most specific assignment covering a fleet wins, and the one on a bare host or site, or on every Linear team, is that place's default.
_Avoid_: Account rule

### What the plugin sends

**Watched set**:
The items whose changes can wake a manager: those the manifest names, and those in the operator's partition gaining or losing the spec or ready label.
_Avoid_: Watch list

**Echo**:
A change the fleet made itself, recognised by its registered rules and dropped rather than sent.
_Avoid_: Self-change, loopback

**Skipped listing**:
A poll's listing of the items a service reports as updated, cut off at its page limit before it got past the cursor, as when a bulk edit updates more issues than the listing holds. It is no failure and the fleet stays watched: the cursor moves as after a listing that fit, the ledger's out-of-scope rows past the page limit go unrecorded, and the poll writes one Dropped entry to the Ledger saying so.
_Avoid_: Stuck band, bulk-change failure

**Wake**:
The plugin's one message to a manager carrying what changed, as one line per change and never text written on the service.
_Avoid_: Notification, ping

### What the operator sees

**Inbox row**:
A row of the manifest's Inbox: one thing that waits on the operator, with what it waits for and since when. A row the plugin cannot read still counts as waiting.
_Avoid_: Task, to-do

**Fleets page**:
The plugin's page in bb's navigation: the fleet board over the queue.
_Avoid_: Dashboard page, Fleet dashboard

**Fleet board**:
The top of the Fleets page: one line per fleet with its manager, Status, spend, polling and fix, problems first and quiet fleets folded. Clicking a line filters the queue to that fleet.
_Avoid_: Fleet cards, fleet list

**Short name**:
How the Fleets page names a fleet on a phone: the end of its full name, its host followed by its path, with as many segments as it takes so that no other registered fleet's full name ends the same way. It reaches the host only where its whole path is also the end of another registered fleet's full name.
_Avoid_: Nickname, display name

A short name changes as fleets are registered and unregistered. The full name stays the accessible name wherever a short name is shown.

**Queue**:
The Fleets page's list of every Inbox row across fleets, oldest first, with tabs by what each row waits for and a Sent tab of the actions seen done in the last hour.
_Avoid_: Waits on you table, inbox table

**Status**:
The fleet board's column of a fleet's four counts, always in this order: Blocked, In flight, Waits on you, and Landed in the last 7 days.
_Avoid_: Counts column

**Problem**:
Something the server flags about a fleet that keeps it from being fully watched or run, such as a missing manifest, a half no account can read, or a manager that is gone; drawn red.
_Avoid_: Error, reason

**Warning**:
Something the server flags about a fleet that needs the operator soon but stops nothing yet, such as a token expiring within 7 days or polling that is late; drawn amber.
_Avoid_: Alert

**Quiet fleet**:
A fleet with every Status count at zero, no problem and no warning. The fleet board folds quiet fleets under one line.
_Avoid_: Idle fleet

**Fleet tab**:
The tab in a manager thread's right panel that shows that fleet in full: its manifest, watched set, credentials, spend and ledger.
_Avoid_: Fleet panel, Fleet detail

**Fleet chip**:
The control in a manager thread's header that spells out the fleet's counts and opens the Fleet tab. Thread Usage calls its own control in the same row the Header chip.
_Avoid_: Header chip, Fleet badge

**Connect popup**:
The popup that connects an account to the fleet half it reads, or adds an account on its own. It opens over the current view.
_Avoid_: Credential wizard

Connect… and Renew… open it on the fleet board, in the Fleet tab and on a toast; Change account… opens it on a Fleet tab credential; and Renew…, Add account or Add token for another owner open it in Settings.

**Action**:
A message the plugin sends a manager for an Inbox row at the operator's word: Answer…, Grant…, Build it, or Re-grant for a grant carried over from a previous manager. The plugin only sends it; the manager acts on the tracker.
_Avoid_: Command, reply

An action is **sent** from the moment bb accepts the message and is **done** once a poll sees its result, which is the row gone from the Inbox or, for Build it, the spec carrying the ready label. A sent action is never marked failed by waiting; bb refusing the message is *not sent*, and the row keeps its action.

### The agreement with run-fleet

**Contract version**:
The integer naming the register call and the manifest's columns that a plugin and a skill share.
_Avoid_: Protocol version

## Flagged ambiguities

- "Cut off" said of a listing: one cut off at its page limit that reached an update after the cursor moves the cursor there and is a plain cut-off; only one that reached nothing after the cursor is a Skipped listing.
