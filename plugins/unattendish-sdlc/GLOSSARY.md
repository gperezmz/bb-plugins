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

**Wake**:
The plugin's one message to a manager carrying what changed, as one line per change and never text written on the service.
_Avoid_: Notification, ping

### What the operator sees

**Inbox row**:
A row of the manifest's Inbox: one thing that waits on the operator, with what it waits for and since when. A row the plugin cannot read still counts as waiting.
_Avoid_: Task, to-do

**Fleets page**:
The plugin's page in bb's navigation, listing every Inbox row of every fleet with its action, a card for each fleet, and what landed in the last 7 days.
_Avoid_: Dashboard page, Fleet dashboard

**Fleet tab**:
The tab in a manager thread's right panel that shows that fleet in full: its manifest, watched set, credentials, spend and ledger.
_Avoid_: Fleet panel, Fleet detail

**Fleet chip**:
The control in a manager thread's header that spells out the fleet's counts and opens the Fleet tab. Thread Usage calls its own control in the same row the Header chip.
_Avoid_: Header chip, Fleet badge

**Action**:
A message the plugin sends a manager for an Inbox row at the operator's word: Answer…, Grant…, Build it, or Re-grant for a grant carried over from a previous manager. The plugin only sends it; the manager acts on the tracker.
_Avoid_: Command, reply

An action is **sent** from the moment bb accepts the message and is **done** once a poll sees its result, which is the row gone from the Inbox or, for Build it, the spec carrying the ready label. A sent action is never marked failed by waiting; bb refusing the message is *not sent*, and the row keeps its action.

### The agreement with run-fleet

**Contract version**:
The integer naming the register call and the manifest's columns that a plugin and a skill share.
_Avoid_: Protocol version
