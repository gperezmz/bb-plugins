# Cache Keeper: settings, surfaces and messages

Source: [`src/server/settings.ts`](../../plugins/cache-keeper/src/server/settings.ts), [`src/core/view.ts`](../../plugins/cache-keeper/src/core/view.ts), [`src/core/messages.ts`](../../plugins/cache-keeper/src/core/messages.ts). The words are defined in [when Cache Keeper acts](../explanation/cache-keeper-timing.md).

## Settings

Under Settings → Plugins → Cache Keeper, or `bb plugin config cache-keeper`.

| Setting | Key | Default | Meaning |
|---|---|---|---|
| Check in on background work | `checkIns` | on | Keep-warms and check-ins on every Claude Code thread. Off sends neither and shows no check-in banner or clock |
| No-output wait | `noOutputWait` | `15 min` | `10 min`, `15 min` or `30 min` without output or progress before a background command or subagent gets a check-in |
| Fetch current prices daily | `fetchPrices` | on | Fetch LiteLLM's and models.dev's public price lists once a day. Off fetches nothing and uses the list bundled with the plugin |

Compact when idle has no setting: it is switched on per thread, from its chip, `bb cache-keeper on` or the agent tool, and stays on until switched off.

## In a thread

Only on Claude Code threads.

| Surface | Shows |
|---|---|
| Composer chip | Compaction only: the icon alone when compact when idle is off, `≥ {line}` when on (`no line` where no size up to the window gives one), `{m}m` counting down while a compaction is due, `paused` while the thread waits on your answer. Hovering gives the full sentence |
| Chip popover | The switch; the line's sentence; a bar from 0 to the context window, filled to the context now, with a handle at the line (drag it between the ten settings, or click its size to type one such as `500k`); `now {context} · {status}`; the model, cache lifetime and calls per message the line rests on; a folded "Why {line}?" with the dollar figures. Where no size up to the window gives a line, the sentence says so (and whether a lower setting would give one, or none does, or the model has no price) and the fold is "Why never?", with the same figures at the whole window |
| Compaction banner | While a compaction is due: "{context} idle · compacting in {m}m before the cache goes cold", with **Skip** and **Compact now**. After Skip: "Skipped until this thread's next idle." with **Undo** |
| Waiting banner | While a keep-warm or check-in is due: how many background commands, subagents, child threads and queued messages the thread waits on, and the time to the next keep-warm or check-in, with **Skip**. Never command text or descriptions |
| Sidebar row | Cache Keeper's icon in place of the status glyph while a compaction is due; a clock while a keep-warm or check-in is due |

**Compact now** compacts whatever the size, provided the thread is idle, waits on no answer and is not waiting.

## The Cache Keeper page

The **Cache Keeper** entry in the sidebar lists the threads with compact when idle on (line, context, status), the threads waiting now (on what, and the next keep-warm or check-in), recent compactions and check-ins, and totals for the last 30 days: compactions and their estimated cost, keep-warms and check-ins and theirs, and the cold rewrites avoided on first messages back. A return counts as avoided only when it came after the cache would have gone cold.

## The messages

Each goes to the thread as a plain text message from you.

**Compaction**: `/compact ` followed by

```text
Also record: approaches that were tried or considered and ruled out, with the reason for each; decisions taken and the reason for each; commands verified to work. If your last message asks the user something, quote the question verbatim with each option and what choosing it would mean.
```

**Keep-warm**: `Still waiting on {items}. Nothing to do yet, just reply "OK".`

`{items}` lists background commands, then background subagents, then child threads, then queued and scheduled messages, oldest first within each, joined as "A", "A and B" or "A, B and C":

| Item | Entry |
|---|---|
| Background command | `background command {id} ("{description}")` |
| Background subagent | `background subagent {id} ("{description}")` |
| Child thread | `child thread {id} ("{title}")` |
| Scheduled message | `a scheduled message due at {HH:MM}` |
| Queued message | `a queued message` |

`{id}` is bb's task id for a background task and the thread id for a child. Descriptions and titles are cut to 60 characters.

**Check-in**: one paragraph per task due, commands before subagents, then `Tell me in a line what you found. Don't wait for me either way.` Durations read "{n} minutes" under an hour and "{h} h {m} min" from an hour on.

| Task | Why | Paragraph |
|---|---|---|
| Command | Stalled | `Background command {id} ("{description}") hasn't printed anything in {quiet}. Can you check it's still moving? Its output is in {outputFile}. If it's stuck, stop it, fix whatever's blocking it and keep going with the task. If it's fine, leave it running.` |
| Command | Routine | `Background command {id} ("{description}") has been running {running} and is still printing. Have a look at the latest output in {outputFile} for repeated errors or retries. If it's looping, stop it, fix it and carry on. If it's fine, leave it running.` |
| Subagent | Stalled | `Background subagent {id} ("{description}") hasn't made progress in {quiet}; its last tool was {lastTool}. Can you check on it? If it's stuck, stop it, then fix the problem or do that part yourself and keep going. If it's fine, leave it.` |
| Subagent | Routine | `Background subagent {id} ("{description}") has been running {running}; its last tool was {lastTool}. Check it's on track. If it's going in circles, stop it and take over that part. If it's fine, leave it.` |

## What it stores

`<data dir>/plugins/cache-keeper/` holds, in SQLite: each thread's switch, setting and idle stretch, the background tasks it watches, 90 days of what it sent, and the fetched price lists. The host entry reads Claude Code's transcripts and the `claude-<uid>/…/tasks/<id>.output` files under `$TMPDIR` or `/tmp` on each machine, and writes nothing there.
