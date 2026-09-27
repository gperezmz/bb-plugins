# Cache Keeper: `bb cache-keeper` and the agent tool

The CLI runs on the bb server. Every command acts on Claude Code threads only, and refuses any other. Source: [`server.ts`](../../plugins/cache-keeper/server.ts).

A `<size>` is tokens: `500k`, `0.5m`, `140000`. It snaps to the nearest of the thread's ten [compaction lines](../explanation/cache-keeper-timing.md#the-compaction-line).

## `bb cache-keeper on`

```text
bb cache-keeper on [<thread>] [--above <size>]
```

Switches compact when idle on for the thread (the current thread by default), at `--above` or at the setting it had.

## `bb cache-keeper off`

```text
bb cache-keeper off [<thread>]
```

Switches it off.

## `bb cache-keeper now`

```text
bb cache-keeper now [<thread>]
```

Compacts the thread now, as **Compact now** does: whatever its size, provided it is idle, waits on no answer and is not [waiting](../explanation/cache-keeper-timing.md#waiting). Otherwise it exits with `not_ready` and says why.

## `bb cache-keeper keep-warm`

```text
bb cache-keeper keep-warm on [<thread>]
bb cache-keeper keep-warm off [<thread>]
```

Switches [keep warm while waiting](../explanation/cache-keeper-timing.md#which-trees-are-kept-warm) on or off for the tree of the thread (the current thread by default), recording the choice on its tree top: the highest Claude Code thread above it, or the thread itself. It prints the state the tree now gets and the tree top:

```text
keep warm while waiting: on
tree top: {title} ({thread id})
```

Under `Never` it still records the choice, and the first line reads `on, but keep-warms are off in Settings` (or `off, …`). It records nothing and exits with an error when:

| Code | When |
|---|---|
| `missing_thread` | No thread was given and there is no current thread |
| `no_tree_top` | The thread is not a Claude Code thread and has no Claude Code thread above it; the message names the tree tops below it, if any |
| `not_ready` | bb lists no such thread |

## `bb cache-keeper status`

```text
bb cache-keeper status [<thread>] [--json]
```

With a thread: on or off, the line, the context now, the status, and what the line rests on (model, cache lifetime, calls per message, size after compacting; `(default)` marks a value not yet measured). Without one: every thread with compact when idle on, then the totals for the last 30 days.

## The `cache_keeper_compact_when_idle` agent tool

Switches compact when idle on for the calling agent's own thread. No agent tool switches keep-warms.

| Parameter | Meaning |
|---|---|
| `above` | Optional `<size>`, snapped the same way |

It returns JSON: `on`, the `line` as a size, and `context`; or `on: false` with an `error`.
