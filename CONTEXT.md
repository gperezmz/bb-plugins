# bb plugins

Plugins that extend bb, the agentic IDE, and the words they share.

## Language

**Compatibility run**:
The scheduled CI run that checks every plugin against bb releases newer than the one the plugins pin.
_Avoid_: Canary, nightly check, smoke test

**Channel**:
The bb release line a compatibility run tests, named by its npm dist-tag: `latest` for releases, `nightly` for nightly builds.
_Avoid_: Track, release stream

**Fixture**:
The configuration and the assertions the npm-install check applies to one plugin after installing it, to exercise what the plugin registers.
_Avoid_: Scenario, smoke config

### Thread Glance

**Needs attention**:
The section at the top of Thread Glance's list that holds every thread family with a thread only you can move forward. In code it is `attention`, bb's own word.
_Avoid_: Needs you, inbox, attention filter

**Attended**:
A family in Needs attention that you opened and that has nothing left needing attention; it keeps its place until none of its threads is open.
_Avoid_: Held, read

**Home group**:
The group a thread family is listed in when it is not in Needs attention: its project, custom section, machine, Pinned or Threads.
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
A thread that is not running, does not need attention and is not the one open.
_Avoid_: Settled, idle thread

**Older fold**:
The "N older" row that holds a group's quiet threads past its newest ones.
_Avoid_: More row, older threads

### OpenAI-compatible inference

**Endpoint**:
One entry in OpenAI-compatible inference's `endpoints` setting, which bb offers as one AI service.
_Avoid_: Server, backend, provider

**AI task**:
A helper job bb hands to an AI service: a thread title, a commit message or a voice transcript.
_Avoid_: Helper completion, helper inference
