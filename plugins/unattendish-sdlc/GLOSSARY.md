# Unattendish

The plugin that wakes the manager thread of an Unattendish fleet when the tracker or forge the fleet waits on changes, and the words it shares with the run-fleet skill.

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

**Credential**:
A token, or a chosen `gh` or `glab` login, and the prefix it applies to.
_Avoid_: Auth entry

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

### The agreement with run-fleet

**Contract version**:
The integer naming the register call and the manifest's columns that a plugin and a skill share.
_Avoid_: Protocol version
