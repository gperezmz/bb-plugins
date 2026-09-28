# Cache Keeper: `bb cache-keeper` and the agent tool

The CLI runs on the bb server. Every command acts on Claude Code threads only, and refuses any other with `not_claude_code`, except `keep-warm`, which takes a thread below a Claude Code tree top. Source: [`server.ts`](../../plugins/cache-keeper/server.ts), [`src/core/above.ts`](../../plugins/cache-keeper/src/core/above.ts), [`src/server/surfaces.ts`](../../plugins/cache-keeper/src/server/surfaces.ts).

## Who may act on which thread

Run from inside a thread, where bb passes the calling thread, `on`, `off`, `compact-now` and `keep-warm` act only on threads in the caller's own thread tree: every thread under the caller's top-level thread, by bb's parent links, archived ones included. For any other thread they exit with `outside_tree` and change nothing. Run from your own terminal, with no calling thread, they act on any thread. `status` reads any thread either way.

## Sizes and lines

A `<size>` is tokens: `500k`, `0.5m`, `140000`. It snaps to the nearest of the thread's ten [compaction lines](../explanation/cache-keeper-timing.md#the-compaction-line), and a size below the lowest line takes the lowest. A thread's lines come only from the context window bb reports for it, which bb learns at the end of the thread's first turn. `--above` and the tool's `above` refuse, and change nothing, when:

| Code | When |
|---|---|
| `window_unknown` | bb has not reported the thread's window yet; the message says it will be known once the thread's first turn ends |
| `above_highest_line` | The size is above the thread's highest line; the message names the window and the highest line |
| `no_line` | No setting has a line: the model has no price, or compacting never repays itself at any setting up to the window; the message says which |
| `bad_size` | The text is not a size |

## `bb cache-keeper on`

```text
bb cache-keeper on [<thread>] [--above <size>]
```

Switches compact when idle on for the thread (the current thread by default), at `--above` or at the setting it had. With `--above` it prints the line it set, `on, line set to 329k (setting 5 of 10)`; without, the line it is at, or that there is none until bb reports the thread's window.

## `bb cache-keeper off`

```text
bb cache-keeper off [<thread>]
```

Switches it off.

## `bb cache-keeper compact-now`

```text
bb cache-keeper compact-now [<thread>]
```

Compacts the thread now, as **Compact now** does: whatever its size and whatever Compact when idle says, provided bb gives it as idle (or ended in failure), not archived or deleted, with no pending interaction, and it is not [waiting](../explanation/cache-keeper-timing.md#waiting). Otherwise it exits with `not_ready` and says why, as it does while a message Cache Keeper sent the thread has not run yet. A thread that is not Claude Code exits with `not_claude_code`, no thread given and no current thread with `missing_thread`, and, run from a thread, a thread outside the caller's tree with `outside_tree`. It and an automatic compaction falling due at the same moment send one `/compact` between them.

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
| `not_ready` | bb has no such thread (run from a thread, a thread bb does not have is outside the caller's tree, and gives `outside_tree`) |
| `outside_tree` | Run from a thread, the thread given is not in the caller's thread tree |

## `bb cache-keeper status`

```text
bb cache-keeper status [<thread>] [--json]
```

With a thread:

| Line | Shows |
|---|---|
| compact when idle | on or off |
| line | The line, or that there is none until bb reports the thread's window |
| context | The context now, and the window |
| status | `working`, `waiting on your answer`, `compacting in {n}m`, `compacted {when}`, `skipped until this thread next runs`, `waiting on background work`, `idle, no line`, `idle, under the line` or `idle`, the first that holds; or `transcript unreadable` when the transcript cannot be read or parsed |
| last decision | What Cache Keeper last sent or held back, when, and why it held it back: see [why nothing was sent](../explanation/cache-keeper-timing.md#why-nothing-was-sent) |
| keep-warms | On or off for its tree, or held because the model has no price |
| price source | `LiteLLM`, `models.dev` or `bundled`, or none |
| rests on | Model, cache lifetime, calls per message and size after compacting; `(default)` marks a value not yet measured |
| transcript unreadable | Why, when it cannot be read |
| last price fetch error | The last error fetching a price list, when there is one |

Without a thread: every thread with compact when idle on, then the totals for the last 30 days. After a [reinstall](cache-keeper-settings.md#after-a-reinstall), the first line says every switch was turned off, until a switch, a Skip or Undo, a line, an Agent tools row or the check-ins setting is next changed. `--json` carries the same fields: the thread's view, `statusText`, `priceSource`, `lastPriceFetchError`, and `reset` after a reinstall.

## The `cache_keeper_compact_when_idle` agent tool

Switches compact when idle on for the calling agent's own thread; it takes no thread id. No agent tool switches keep-warms.

A thread is offered it only while its row in [Agent tools](cache-keeper-settings.md#agent-tools) is on, which it is not on a fresh install. A call from a session that started while the row was on, made after it was switched off, is refused and changes nothing.

| Parameter | Meaning |
|---|---|
| `above` | Optional `<size>`, snapped and refused as [above](#sizes-and-lines) |

It returns JSON: `on: true`, the `line` as a size (`never` where the setting has no line), the `setting`, `context` and `windowKnown`; or `on: false` with an `error`.
