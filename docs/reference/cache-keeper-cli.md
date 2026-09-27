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

## `bb cache-keeper status`

```text
bb cache-keeper status [<thread>] [--json]
```

With a thread: on or off, the line, the context now, the status, and what the line rests on (model, cache lifetime, calls per message, size after compacting; `(default)` marks a value not yet measured). Without one: every thread with compact when idle on, then the totals for the last 30 days.

## The `cache_keeper_compact_when_idle` agent tool

Switches compact when idle on for the calling agent's own thread.

| Parameter | Meaning |
|---|---|
| `above` | Optional `<size>`, snapped the same way |

It returns JSON: `on`, the `line` as a size, and `context`; or `on: false` with an `error`.
