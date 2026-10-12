# Cache Keeper

The plugin that compacts idle Claude Code threads before their prompt cache goes cold and keeps threads waiting on background work warm.

## Language

**Cache Keeper**:
The plugin that keeps Claude Code threads cheap to come back to after their turn ends, by compacting them or keeping their prompt cache warm before it expires.
_Avoid_: Idle Compact, cache warmer

**Compaction line**:
The context size at or above which Cache Keeper compacts a thread with compacting switched on, once its turn has ended and just before its cache expires.
_Avoid_: Threshold, trigger

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
A turn Cache Keeper sends a thread whose turn has ended about its own stalled task, or a question folded into its keep-warm about a task that has run long. It asks the agent to check the work and report what it finds.
_Avoid_: Nudge

**Stalled task**:
A background command or subagent with no new output or progress for the no-output wait.
_Avoid_: Quiet task, stuck task

**Check on stalled tasks**:
Cache Keeper's setting, off until switched on, that sends a check-in about every stalled task on every Claude Code thread; it sits in the Stalled tasks section of its settings page.
_Avoid_: Check in on stalled background work, check-ins setting

**No-output wait**:
How long a background command or subagent may go without output or progress before it is a stalled task, set in Cache Keeper's settings.
_Avoid_: Check-in wait, stall timeout

**Compact when idle**:
Cache Keeper's per-thread switch that has a thread compacted at its deadline when its turn ends at or above its compaction line.
_Avoid_: Auto-compact, idle compact

**Composer chip**:
Cache Keeper's button in a Claude Code thread's composer, showing Compact when idle's state in its text and whether a waiting thread is kept warm in its icon; its popover holds the thread's switches.
_Avoid_: Chip, Cache Keeper chip

**Timer icon**:
Cache Keeper's icon, a dial with one hand and a crown, drawn on its nav item, its banner, its composer chip unless the thread is waiting with its turn ended, and a row of bb's built-in thread list whose compaction is due. Thread Glance's rows draw no other plugin's status, so they never show it.
_Avoid_: Clock, stopwatch, Cache Keeper logo

**Flame**:
Cache Keeper's glyph, on a row of bb's built-in thread list (never one of Thread Glance's) and, once the thread's turn has ended, on the composer chip, while a keep-warm is planned for its thread or a thread below it.
_Avoid_: Fire, warm icon

**Crossed-out flame**:
The flame with one diagonal stroke across it, on the composer chip while its thread is waiting with its turn ended and its cache is not kept warm. It never appears in the sidebar.
_Avoid_: Flame off, cold icon, no-flame

**Keep warm while waiting**:
Cache Keeper's switch on the topmost Claude Code thread of a thread tree that has keep-warms sent to it and every thread below it while they wait. Until you flip it, it follows the "Keep caches warm while waiting" setting.
_Avoid_: Keep-warm switch, warm toggle

**Tree top**:
A Claude Code thread with no Claude Code thread above it, where a thread tree's Keep warm while waiting switch sits; a tree whose root is not a Claude Code thread has one per Claude Code branch.
_Avoid_: Top thread, branch top

**Deadline**:
The moment Cache Keeper acts on a thread: its most recent request's time plus its cache lifetime, less a small margin.
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
Cache Keeper's listing of every bb thread every few minutes, which corrects what a missed event left wrong; the only work it does over every thread.
_Avoid_: Pass, poll

**Fair floor**:
The blind design's prototype measured on the same machine with Cache Keeper's own transport to bb and validation of bb's and the host's replies; the benchmark's targets are twice it.
_Avoid_: Baseline, blind floor

**Drive harness**:
The throwaway bb, fake Anthropic API and scripts committed with Cache Keeper that drive it against real Claude Code threads on a clock the harness can move forward.
_Avoid_: Test bb, e2e rig
