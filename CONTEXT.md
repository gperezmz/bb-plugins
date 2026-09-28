# bb plugins

Plugins that extend bb, the agentic IDE, and the words they share.

## Language

**Compatibility run**:
The scheduled CI run that checks every plugin against bb releases newer than the one the plugins pin.
_Avoid_: Canary, nightly check, smoke test

**Channel**:
The bb release line a compatibility run tests, named by its npm dist-tag: `latest` for releases, `nightly` for nightly builds.
_Avoid_: Track, release stream

**Thread tree**:
A top-level thread and every thread below it, its child threads and theirs.
_Avoid_: Family, thread family, waiting tree

**Fixture**:
The configuration and the assertions the npm-install check applies to one plugin after installing it, to exercise what the plugin registers.
_Avoid_: Scenario, smoke config

### Thread Glance

**Needs attention**:
The section at the top of Thread Glance's list that holds every thread tree with a thread only you can move forward. In code it is `attention`, bb's own word.
_Avoid_: Needs you, inbox, attention filter

**Attended**:
A thread tree in Needs attention that you opened and that has nothing left needing attention; it keeps its place until none of its threads is open.
_Avoid_: Held, read

**Home group**:
The group a thread tree is listed in when it is not in Needs attention: its project, custom section, machine, Pinned or Threads.
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

**Status column**:
The column at the left of every Thread Glance row where its status glyph sits, a faint ring when the thread is idle.
_Avoid_: Glyph slot, indent, gutter

### Pocket Navigation

**Pocket Navigation**:
The plugin that draws bb's sidebar navigation as one row of icons and a New thread line on a phone.
_Avoid_: Compact navigation, mobile nav, nav strip plugin

**Icon row**:
Pocket Navigation's line below the New thread line: an icon button for every entry bb's settings show other than New thread and search, then "…" when any entry is hidden.
_Avoid_: Icon strip, toolbar, nav bar

**New thread line**:
Pocket Navigation's top line: its full-width New thread button, with search at its right end when search is shown.
_Avoid_: New thread row, action bar

### OpenAI-compatible inference

**Endpoint**:
One entry in OpenAI-compatible inference's `endpoints` setting, which bb offers as one AI service.
_Avoid_: Server, backend, provider

**AI task**:
A helper job bb hands to an AI service: a thread title, a commit message or a voice transcript.
_Avoid_: Helper completion, helper inference

### Cache Keeper

**Cache Keeper**:
The plugin that keeps Claude Code threads cheap to come back to after their turn ends, by compacting them or keeping their prompt cache warm before it expires.
_Avoid_: Idle Compact, cache warmer

**Compaction line**:
The context size at or above which Cache Keeper compacts a thread with compacting switched on, once its turn has ended and just before its cache expires.
_Avoid_: Threshold, trigger, N

**Keep-warm**:
A turn Cache Keeper sends a thread whose turn has ended while it still waits on background work, child threads or a scheduled message, so its cache, and through its report every cache above it, is warm when they report back.
_Avoid_: Ping, heartbeat

**Report**:
bb's message into a parent thread that turns of its child threads ended, naming each child and, for a single child, quoting its last reply.
_Avoid_: Notification, completion message, child update

**Cache Keeper turn**:
A turn whose every input is a message Cache Keeper sent or a report of a Cache Keeper turn; any other input makes it a real turn.
_Avoid_: Synthetic turn, quiet turn, plugin turn

**Nothing-new reply**:
The fixed line a keep-warm or check-in asks the agent to reply with when nothing is wrong, starting "Not finished yet" or "Checked" and ending "Nothing needed from you".
_Avoid_: OK reply, quiet reply

**Tree keep-warm**:
The keep-warms Cache Keeper sends at the same moment to the waiting threads at the bottom of a thread tree, early enough that their reports climb to every thread above and keep it warm in one batched turn each.
_Avoid_: Family keep-warm, group ping, batch keep-warm

**Check-in**:
A turn Cache Keeper sends a thread whose turn has ended about its own stalled task, or a question folded into its keep-warm about a task running over 30 minutes. It asks the agent to check the work and report what it finds.
_Avoid_: Nudge

**Stalled task**:
A background command or subagent with no new output or progress for the no-output wait.
_Avoid_: Quiet task, stuck task

**No-output wait**:
How long a background command or subagent may go without output or progress before it is a stalled task: 10, 15 or 30 minutes, set in Cache Keeper's settings.
_Avoid_: Check-in wait, stall timeout

**Compact when idle**:
Cache Keeper's per-thread switch that has a thread compacted at its deadline when its turn ends at or above its compaction line.
_Avoid_: Auto-compact, idle compact

**Composer chip**:
Cache Keeper's button in a Claude Code thread's composer, showing Compact when idle's state; its popover holds the thread's switches.
_Avoid_: Chip

**Keep warm while waiting**:
Cache Keeper's switch on the topmost Claude Code thread of a thread tree that has keep-warms sent to it and every thread below it while they wait. Until you flip it, it follows the "Keep caches warm while waiting" setting.
_Avoid_: Keep-warm switch, warm toggle

**Tree top**:
A Claude Code thread with no Claude Code thread above it, where a thread tree's Keep warm while waiting switch sits; a tree whose root is not a Claude Code thread has one per Claude Code branch.
_Avoid_: Top thread, branch top

**Deadline**:
The moment Cache Keeper acts on a thread: its most recent request's time plus its cache lifetime, minus one minute.
_Avoid_: Expiry, TTL, timer

**Idle stretch**:
A thread's time from turning idle until it next becomes active for anything other than a message Cache Keeper sent, or a child thread's report of a turn such a message started.
_Avoid_: Idle period, idle session

**Waiting**:
A thread with a background command or subagent running, a queued or scheduled message, or a direct child thread still working or itself waiting.
_Avoid_: Blocked, on hold

**Cost stop**:
The point in an idle stretch past which Cache Keeper sends a thread no more keep-warms: when their cost, with its share of the turns their reports force in the threads above and each unmeasured one at its forecast, would pass that of rewriting its context cold. A thread with no price counts as past it.
_Avoid_: Budget, cap

**Agent tools**:
The section of Cache Keeper's settings with one switch per agent tool it registers, each off until switched on, deciding which tools a thread's agent is offered.
_Avoid_: Tool permissions, agent settings

**Reconciliation check**:
Cache Keeper's listing of every bb thread every 5 minutes, which corrects what a missed event left wrong; the only work it does over every thread.
_Avoid_: Pass, poll

**Fair floor**:
The blind design's prototype measured on the same machine with Cache Keeper's own transport to bb and validation of bb's and the host's replies; the benchmark's targets are twice it.
_Avoid_: Baseline, blind floor

**Drive harness**:
The throwaway bb, fake Anthropic API and scripts committed with Cache Keeper that drive it against real Claude Code threads on a clock the harness can move forward.
_Avoid_: Test bb, e2e rig
