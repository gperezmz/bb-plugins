# Cache Keeper: settings, surfaces and messages

Source: [`src/server/settings.ts`](../../plugins/cache-keeper/src/server/settings.ts), [`src/core/view.ts`](../../plugins/cache-keeper/src/core/view.ts), [`src/core/messages.ts`](../../plugins/cache-keeper/src/core/messages.ts). The words are defined in [when Cache Keeper acts](../explanation/cache-keeper-timing.md).

## Settings

Under Settings → Plugins → Cache Keeper, or `bb plugin config cache-keeper`.

| Setting | Key | Default | Meaning |
|---|---|---|---|
| Keep caches warm while waiting | `keepWarm` | `Only threads switched on` | Which thread trees get keep-warms while their switch is untouched: `Every waiting thread`, `Only threads switched on` (none) or `Never`. Under `Never` no tree gets them, whatever its switch records. See [which trees are kept warm](../explanation/cache-keeper-timing.md#which-trees-are-kept-warm) |
| Check in on stalled background work | `stalledCheckIns` | off | Check-ins on a stalled task, on every Claude Code thread, whatever its switch or the setting above says. Off, as on a fresh install, sends none, and no keep-warm asks about a task running 30 minutes or more |
| No-output wait | `noOutputWait` | `15 min` | `10 min`, `15 min` or `30 min` without output or progress before a background command or subagent gets a check-in |
| Fetch current prices daily | `fetchPrices` | on | Fetch LiteLLM's and models.dev's public price lists once a day. Off fetches nothing and uses the list bundled with the plugin |

Compact when idle has no setting: it is switched on per thread, from its composer chip, `bb cache-keeper on` or the agent tool, and stays on until switched off. Keep warm while waiting is switched per thread tree on its tree top, from the composer chip's popover, the banner's **Keep warm** or `bb cache-keeper keep-warm`; there is no agent tool for it. A setting changed takes effect at once, without a restart.

### Agent tools

Below the settings, a section headed **Agent tools** has a row with a switch for each agent tool Cache Keeper registers. Today that is one row, **Compact when idle**, for [`cache_keeper_compact_when_idle`](cache-keeper-cli.md#the-cache_keeper_compact_when_idle-agent-tool). Every row is off on a fresh install. A thread is offered a tool only while its row is on, and a change reaches a thread when its Claude Code session next starts or resumes; a session already running keeps the tools it started with, and a call to a tool whose row is now off is refused.

## In a thread

Only on Claude Code threads.

| Surface | Shows |
|---|---|
| Composer chip | Compaction only: the timer icon alone when compact when idle is off, `≥ {line}` when on (`no line` where no size up to the window gives one, or while bb has not reported the thread's context window), `{m}m` counting down while a compaction is due, `paused` while the thread waits on your answer. Hovering gives the full sentence, then whether the thread is kept warm while it waits, or that keep-warms are off in Settings. While the window is unknown and compact when idle is on, the sentence is "Compact when idle is on. Its line is set once this thread's first turn ends." |
| Composer chip's popover | See [the popover](#the-composer-chips-popover) |
| Banner | One line above the composer, with no tooltip; see [the banner](#the-banner) |
| Sidebar row | The timer icon in place of the status glyph while a compaction is due; the flame while a keep-warm is planned for the thread or a thread below it, which happens only in a tree kept warm |

**Compact now** compacts whatever the size, provided the thread is idle, waits on no answer and is not waiting.

### The composer chip's popover

From the top:

| Block | Shows |
|---|---|
| **Keep warm while waiting** | Its switch, showing whether the thread's tree is kept warm now: a switch on a tree top; greyed out on a thread below one, with "Set on {tree top's title}", which opens the tree top; greyed out everywhere under `Never` |
| **Compact when idle** | Its switch |
| Context bar | A bar from 0 to the context window, filled to the context now, with the compaction line on its handle. Drag the handle between the ten settings, step it with the arrow keys, or click its size to type one such as `500k` and press Enter. Hidden while bb has not reported the thread's window |
| Status line | `Now {context} · {status}`, each side starting with a capital: `Working`, `Waiting on your answer`, `Compacting in {m}m`, `Compacted {time} ago`, `Skipped until this thread next runs`, `Waiting on background work`, `Idle, no line`, `Idle, under the line` or `Idle`. `{context}` is `unknown` until the transcript has been read |
| **Details** | Closed when the popover opens; one click opens it. The model, cache lifetime and calls per message the line rests on, then "Why {line}?" with the dollar figures at the line, or, where no size up to the window gives one, "Why never?" with the same figures at the whole window and whether a lower setting would give a line. The figures are left out while the window is unknown or the model has no price |
| Error | Only while the last action from the popover has failed: what went wrong |

### The banner

Shown only on an idle thread that waits on no answer, and never with command text or descriptions.

| When | Text | Buttons |
|---|---|---|
| A compaction is due | `Compacting in {n}m, before the cache goes cold` | **Skip**, **Compact now** |
| After Skip on a compaction | `Skipped until this thread next runs` | **Undo** |
| Waiting in a tree kept warm, and a keep-warm is planned for the thread or for a thread below it whose report will reach it | `Waiting on {counts}, keeping cache warm` | **Skip** |
| Waiting in a tree kept warm, and none is planned: past the cost stop, after a Skip above, or with the cache already cold | `Waiting on {counts}, letting cache go cold` | none |
| Waiting in a tree kept warm, after Skip on keep-warms | `Skipped for this wait` | **Undo** |
| Waiting in a tree kept warm, and the model has no price, or a price with no cache read or cache write rate, or one of 0 | `Waiting on {counts}, not keeping cache warm: this model has no price` | none |
| Waiting, with the tree top's switch off | `Waiting on {counts}, not keeping cache warm` | **Keep warm** |
| Waiting, under `Never` | `Waiting on {counts}, keep-warms are off in Settings` | none |

`{counts}` is `N thread(s)`, `N command(s)`, `N subagent(s)`, `N queued message(s)` and `N scheduled message(s)`, in that order, leaving out kinds with none, joined as "A", "A and B" or "A, B and C". Skip on keep-warms stops them for this thread and every thread below it until the wait ends, and leaves the switch as it is; check-ins on a stalled task still go. **Keep warm** switches the tree top's switch on, from any thread in the tree, and the banner changes to `keeping cache warm`. Where the thread's cache went cold before you pressed it, keep-warms cannot warm it again: the banner reads `letting cache go cold` until the next request, whoever makes it, warms the cache, and keep-warms go from then on.

## The Cache Keeper page

The **Cache Keeper** entry in the sidebar lists the threads with compact when idle on (line, context, status), every idle thread waiting now (on what, and the next keep-warm, or `off` where its tree is not kept warm), what was sent recently, and totals for the last 30 days: compactions and their cost, keep-warms and check-ins and theirs, and the cold rewrites avoided on first messages back. A return counts as avoided only when it came after the cache would have gone cold.

Each entry in the recent list is one send, with its real cost once its turns have run, including the report turns it forced in the threads above; hovering the cost shows how it fell between threads. Until then, and for good where its turn's cost cannot be read from the transcript, a keep-warm or check-in shows its forecast marked as an estimate, `≈$0.12`, and hovering says so; no sent keep-warm shows $0. A compaction shows its estimate, since `/compact` writes no usage to the transcript, and a check-in sent past the cost stop shows the cold-write price. A send bb refused or that failed is not listed.

| Entry | Sent |
|---|---|
| `Kept warm` | A keep-warm to one thread |
| `Kept warm, N threads` | A tree keep-warm to N threads at the same moment |
| `Kept warm, checked {task id}` | A keep-warm that also asked about a task running 30 minutes or more; with several threads, `Kept warm, N threads, checked {task id}` |
| `Checked {task id}` | A check-in on a stalled task |
| `Compacted {before} → {after}` | A compaction |

## The messages

Each goes to the thread as a plain text message from you.

**Compaction**: `/compact ` followed by

```text
Also record: approaches that were tried or considered and ruled out, with the reason for each; decisions taken and the reason for each; commands verified to work. If your last message asks the user something, quote the question verbatim with each option and what choosing it would mean.
```

**Keep-warm**:

```text
Still waiting on {items}. There's no need to check anything. Reply with exactly "Not finished yet, still waiting on {items}. Nothing needed from you."
```

A keep-warm that folds in tasks running 30 minutes or more is `Still waiting on {items}.`, then one routine paragraph per task (below), then the check-in's closing line.

`{items}` lists background commands, then background subagents, then child threads, then queued and scheduled messages, oldest first within each, joined as "A", "A and B" or "A, B and C"; it is `background work` while bb counts tasks Cache Keeper has not read yet:

| Item | Entry |
|---|---|
| Background command | `background command {id} ("{description}")` |
| Background subagent | `background subagent {id} ("{description}")` |
| Child thread | `child thread {id} ("{title}")` |
| Scheduled message | `a scheduled message due at {HH:MM}` |
| Queued message | `a queued message` |

`{id}` is bb's task id for a background task and the thread id for a child. Text that comes from outside Cache Keeper (task ids and descriptions, thread titles, tool names) is cut to 60 characters, and has quotes, backslashes and line breaks escaped as `\"`, `\\` and `\n` and tabs turned into spaces. A background command's `{outputFile}` is escaped the same way but not cut.

**Check-in**: one stalled paragraph per task due, commands before subagents, then

```text
A task that's quiet on purpose, such as a server or a watcher, is fine to leave running. If nothing is wrong, reply with exactly "Checked {task ids}, still running normally, nothing new. Nothing needed from you." Otherwise tell me in a line what you found. Don't wait for me either way.
```

`{task ids}` joins every task asked about as "A", "A and B" or "A, B and C". Durations read "{n} minutes" under an hour and "{h} h {m} min" from an hour on. No message names Cache Keeper or tells the agent to stop, kill or restart anything, and each carries Cache Keeper's `pluginSubmission`.

| Task | When | Paragraph |
|---|---|---|
| Command | Stalled | `Background command {id} ("{description}") hasn't printed anything in {quiet}. Can you check on it? Its output is in {outputFile}.` |
| Command | Folded into a keep-warm | `Background command {id} ("{description}") has been running {running} and is still printing. Have a look at the latest output in {outputFile} for repeated errors or retries.` |
| Subagent | Stalled | `Background subagent {id} ("{description}") hasn't made progress in {quiet}; its last tool was {lastTool}. Can you check on it?` |
| Subagent | Folded into a keep-warm | `Background subagent {id} ("{description}") has been running {running}; its last tool was {lastTool}. Can you check it's on track?` |

## What it stores

`<data dir>/plugins/cache-keeper/data.db` holds, in SQLite: each thread's switches, setting, idle stretch and charges, the background tasks it watches, how far it has read each thread's transcript and turns in bb's event history, its last decision, the read state to put back after a Cache Keeper turn, 90 days of what it sent and what that cost, the Agent tools rows, and the fetched price lists. A thread's row is at most about 600 bytes, and its turn log at most 8 KB.

It tidies itself: a thread bb deletes loses its rows; a thread bb archives loses its turn log and keeps its switches, which it still has when unarchived; history and sends older than 90 days are pruned nightly, and the database, created with `auto_vacuum = incremental`, gives the freed pages back after each prune. The host entry reads Claude Code's transcripts and the `claude-<uid>/…/tasks/<id>.output` files under `$TMPDIR` or `/tmp` on each machine, and writes nothing there.

### After a reinstall

`bb plugin uninstall` clears the settings and keeps `data.db`. On its first load after being installed again, Cache Keeper switches off every thread's Compact when idle and every tree top's recorded Keep warm while waiting, clears every Skip, and switches off every Agent tools row and "Check in on stalled background work", so nothing is spent unasked. The first line of `bb cache-keeper status` says so until a switch, a Skip or Undo, a line, an Agent tools row or the check-ins setting is next changed. A first install finds `data.db` empty and changes nothing.
