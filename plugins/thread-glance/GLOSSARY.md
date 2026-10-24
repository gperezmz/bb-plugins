# Thread Glance

The plugin that replaces the sidebar thread list with one that shows each thread's state, harness and child threads at a glance.

## Language

**Parent thread**:
The thread that spawned a child thread.
_Avoid_: Manager, owner

**Focused thread**:
The thread in the pane of bb's window that has focus.
_Avoid_: Current thread

**Open thread**:
A thread shown in any pane of bb's window, the focused thread or one in another split pane. Its row is highlighted when it is the focused thread and tinted when it is in another pane.
_Avoid_: Viewed thread

**Attention**:
bb's latest-attention time for a thread moving later: a turn that ends, a failure, a question or approval that arrives. Thread Glance compares it with the time a thread was parked, snoozed or settled to decide whether that thread comes back.
_Avoid_: Notification

**Busy thread**:
A thread that is not at rest: it has a pending question or approval, a queued or failed queued message, a turn in flight, any activity counter (workflows, background agents or commands, plan mode, goals), or a runtime that is starting, active or provisioning. One rule decides it for every button, check and automatic action; a busy thread cannot be snoozed, parked or settled.
_Avoid_: In-use thread

**Never-run thread**:
A thread bb lists as `pending`: created, and not yet run. It has no turn in flight, so it is at rest unless a first message is queued; a queued first message, scheduled for later or not, makes it a busy thread but never a working one.
_Avoid_: Pending thread, unstarted thread

**Shelf**:
One of the sections of Thread Glance's list that a thread sits on by its lifecycle: Pinned, Active, Working, Inactive, Snoozed, Parked or Settled.
_Avoid_: Bucket, lane

**Lifecycle row**:
What Thread Glance's server keeps for a thread that is not simply Active: when it was settled and whether by you or automatically, when it was parked, when it was snoozed and until when, an active override, and the attention a hold set aside. A thread without one is Active.
_Avoid_: Thread state, status record

The active override is set by Resume and Un-settle and lasts until the thread next starts a turn; it also stops automatic settling from touching the thread.

**Snooze preset**:
One entry of the snooze shortcuts setting: an optional label and either a duration or a named time of day, offered in the Snooze menu and the card's clock menu.
_Avoid_: Snooze option

**Woke**:
The state of a thread back from a snooze, at its wake time or on new attention, until you open it or dismiss its marker; a snoozed thread is also woke while it is a lifted thread, with no marker to dismiss. It is on Active, in bold, with a Woke label, and is the same in every window and after a reload.
_Avoid_: Awake, unsnoozed

**Lifted thread**:
A thread with a question or approval waiting on a thread below it, at any depth. It sits on Active, cannot be snoozed, parked or settled, and goes back to its shelf with the marks of its lifecycle row kept once no such question waits, answered or not; its mark is held meanwhile.
_Avoid_: Surfaced thread, raised thread

**Hold**:
What keeps the park, snooze or settle mark of a lifted thread while the question waits: turns in its tree neither reopen it nor count as attention against it, and the attention it has meanwhile is set aside in its lifecycle row. It is the mark that is held, never the thread.
_Avoid_: Freeze, suspend

**Parked thread**:
A thread you have set aside while someone else replies. It sits on Parked, showing how long it has waited, until attention returns it to Active or you resume it.
_Avoid_: Shelved thread, held thread

**Settled thread**:
A thread on Settled, put there by you or automatically after it went quiet or its pull request closed. Settling covers a whole thread tree, and attention or Un-settle returns the thread to Active.
_Avoid_: Older thread, done thread

**Inactive thread**:
A thread left on Active that is not busy, does not need you, is not woke or lifted, and has had no activity for the hours before inactive. It sits on Inactive.
_Avoid_: Stale thread, dormant thread

**Manual order**:
The order of the threads on Active, set by dragging or with Alt+Arrow, stored on the server as one list for every thread outside Pinned across all projects and shelves, and followed by every window. Working and Inactive follow it too.
_Avoid_: Custom order, drag order

**Reclaim**:
What Thread Glance does after a park, snooze or settle, once the thread is still unpinned, not busy and unchanged: it stops the thread's agent runtime and closes its terminals that are running but have never had input, leaving the rest.
_Avoid_: Cleanup

**Port indicator**:
The small mark on a card, shown while a listening process works inside the thread's workspace; its hover card lists every listener in that environment.
_Avoid_: Port badge, port chip

**Owned port**:
A listening port whose process carries, once, the thread id bb gives every process an agent starts, naming a thread that works in the same environment. Any other port in a workspace belongs to the workspace only.

Only owned ports are closed after a settle and by Clean, and an owned port holds back auto-settle.
_Avoid_: Thread port, claimed port

**Clean**:
Closing the live terminals and owned ports of settled threads, from a button on the Settled header after a preview. Unlike Reclaim, it closes every running terminal, typed into or not, and no thread leaves Settled.
_Avoid_: Purge, resource cleanup

**Port link machine**:
The machine, chosen per device on the settings page, whose ports a row links to from this device; with none chosen, ports are not links.
_Avoid_: Link host, port host

**Project scope**:
The picker at the top of Thread Glance's list that limits every shelf to the projects ticked in it, or to all of them when none is. It is saved per window: a reload keeps it, another window has its own, and a new window starts on All projects. It marks a project left out of it that has a thread needing you.
_Avoid_: Project filter

**Project colour**:
The colour a project has while project colours are on: soft and automatic from the project's id, or an override picked in settings. It colours the project's name, its stripe and its monogram.
_Avoid_: Project theme

**Group by worktree**:
The setting that, under the Active sort Project, gathers the root threads of a project that share a bb worktree under its branch, in a group that collapses and moves as one inside the project's group.
_Avoid_: Group by environment, worktree grouping

**Stripe**:
The 2 px bar at the left edge of a row, in the project colour, shown where the setting for where stripes show allows.
_Avoid_: Accent bar, colour bar

**Monogram**:
The uppercase first letter of a project's name, on a tile, drawn where the project has no icon or its icon fails to load.
_Avoid_: Initial, avatar

**Shelf rule**:
The faint line across a shelf's header from its chevron to its controls or right edge. It is part of the header's toggle and takes only the width the shelf's name leaves.
_Avoid_: Divider, hairline

**Full card**:
A row of three lines: the project's icon and name with the status slot, the title, and the branch with the children chip, pull request badge and harness logo. Used on Pinned, Active and Inactive, and for a working thread unless it is folded.
_Avoid_: Big row, expanded row

**Folded card**:
A row of one line: project name and title, the children chip, an unpin button and the live status. Used for working threads while compacting working threads is on and for every row of Working; it unfolds when the work ends, fails or needs you.
_Avoid_: Compact row, collapsed card

**Slim row**:
A one-line row, 32 px tall, showing project name, title, the children chip and the shelf's label, with a button to restore the thread on hover. Used on Parked, Snoozed and Settled.
_Avoid_: Thin row, mini row

**Status slot**:
The 80 px right-aligned part of a card that shows one thing, the first that applies: Needs you, Send failed or Queued, the indicator's label, or else the thread's age.
_Avoid_: Trailing slot, status column

**Children chip**:
The control on a parent thread's card or slim row showing the number of its direct, non-archived children, up to three child marks, the glyph of the most urgent state in its whole subtree, and a chevron that opens and closes the child list.
_Avoid_: Chip, Pill, children badge, child dot

**Parent button**:
The button in a thread's header that goes back to its parent thread.
_Avoid_: Back button, parent link

**Children button**:
The button in a thread's header that opens a popover listing its children.
_Avoid_: Subthreads button

**Hover card**:
The card that opens beside a row after the pointer rests on it, or at once on keyboard focus, showing the thread's project, machine, branch, harness, model and the branch's pull request.
_Avoid_: Details panel

**Thread record**:
One thread's lifecycle row as Thread Glance's server sends it, whole, whenever it changes or a client catches up.
_Avoid_: Thread data, thread entry

**Spacer**:
The empty block standing in for a run of a shelf's rows the list has not mounted, as tall as they are, naming their threads for bb's keyboard navigation.
_Avoid_: Placeholder, chunk, filler

## Flagged ambiguities

- "Held thread" is only an avoid-word for a parked thread; a lifted thread's mark is held, not the thread.
- "Active thread" is a thread on the Active shelf; the thread in the pane that has focus is the focused thread.
- The settings page spells its labels in US English ("Project colors", "Thread behavior"); the docs name those labels as they read and write colour otherwise.
- "Thread ports" and "thread-owned ports" appear only in the settle prompt's messages, worded as the spec gives them; they mean owned ports.
- "Cleanup" is only the name of Clean's expired preview message; the action is Clean, and what Thread Glance does after a park, snooze or settle is Reclaim.
- "bb's own list" and "bb's list" name the built-in thread list, a plugin Thread Glance replaces, not bb core; what that list does is not what bb does.
