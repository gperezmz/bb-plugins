# bb plugins

Plugins that extend bb, the agentic IDE, and the words they share.

## Language

### Thread Glance

**Needs you**:
The section at the top of Thread Glance's list that holds every thread family with a thread only you can move forward. A family leaves it once nothing in it needs you and you have opened another thread. A family enters it only while none of its threads is open: opening a thread judges its family afresh, and nothing that then happens in the family moves it in.
_Avoid_: Needs attention, inbox, attention filter

**Home group**:
The group a thread family is listed in when it is not in Needs you: its project, custom section, machine, Pinned or Threads.
_Avoid_: Source group, original group

**Parent thread**:
The thread that spawned a child thread.
_Avoid_: Manager, owner

**Orphaned failure**:
A child thread's failure that its parent thread went idle without handling. It reaches Needs you even with the child-thread checkbox off.
_Avoid_: Unhandled failure, stuck child

**Chip**:
The count badge beside a parent thread's title that opens and closes its children.
_Avoid_: Pill, children badge

**Quiet thread**:
A thread that is not running, does not need you and is not the one open.
_Avoid_: Settled, idle thread

**Older fold**:
The "N older" row that holds a group's quiet threads past its five newest.
_Avoid_: More row, older threads
