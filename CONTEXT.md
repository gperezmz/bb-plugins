# bb plugins

Plugins that extend bb, the agentic IDE, and the words they share.

## Language

**Compatibility run**:
The scheduled CI run that checks every plugin against bb releases newer than the one the plugins pin.
_Avoid_: Canary, nightly check, smoke test

### Thread Glance

**Needs you**:
The section at the top of Thread Glance's list that holds every thread family with a thread only you can move forward.
_Avoid_: Needs attention, inbox, attention filter

**Home group**:
The group a thread family is listed in when it is not in Needs you: its project, custom section, machine, Pinned or Threads.
_Avoid_: Source group, original group

**Parent thread**:
The thread that spawned a child thread.
_Avoid_: Manager, owner

**Orphaned failure**:
A child thread's failure that its parent thread went idle without handling.
_Avoid_: Unhandled failure, stuck child

**Chip**:
The count badge beside a parent thread's title that opens and closes its children.
_Avoid_: Pill, children badge

**Quiet thread**:
A thread that is not running, does not need you and is not the one open.
_Avoid_: Settled, idle thread

**Older fold**:
The "N older" row that holds a group's quiet threads past its newest ones.
_Avoid_: More row, older threads

### OpenAI-compatible inference

**Endpoint**:
One OpenAI-compatible server listed in OpenAI-compatible inference's settings, which bb offers as one AI service.
_Avoid_: Server, backend, provider

**AI task**:
A helper job bb hands to an AI service: a thread title, a commit message or a voice transcript.
_Avoid_: Helper completion, helper inference
