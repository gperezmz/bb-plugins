# Cache Keeper: first run

In this tutorial you install Cache Keeper, switch Compact when idle on for one thread and choose its line, switch Keep warm while waiting on for a thread tree, and find what Cache Keeper did on its page and in the CLI. You need a bb server you can install plugins on and one project with a Claude Code agent that can run. Cache Keeper acts only on Claude Code threads.

## 1. Install it

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin cache-keeper
```

Open any Claude Code thread. At the right of the composer's action row there is now Cache Keeper's icon: the [composer chip](../reference/cache-keeper-settings.md#in-a-thread). The sidebar has a new **Cache Keeper** entry.

## 2. See what it does on its own

Nothing yet. Cache Keeper sends nothing to any thread until you switch something on:

- **Compact when idle** is off on every thread; the composer chip shows its icon alone.
- **Keep warm while waiting** is off on every thread tree, since Settings → Plugins → Cache Keeper → **Keep caches warm while waiting** starts at `Only threads switched on`.
- **Check in on stalled background work**, on the same settings page, is off, so no thread gets a check-in about a background task that stopped printing until you switch it on there.

## 3. Switch Compact when idle on for one thread

Start a new Claude Code thread in your project with a first message that keeps it busy for a minute, for example:

```text
Read every Markdown file in this project and summarise each in one line.
```

While it works, click its composer chip. The popover opens with:

- **Keep warm while waiting**, with its switch;
- **Compact when idle**, with its switch;
- the status line, such as `Now unknown · Working`;
- **Details**, closed.

Turn on **Compact when idle**. The composer chip now reads `no line`. Hover it: "Compact when idle is on. Its line is set once this thread's first turn ends." The popover has no context bar yet, because bb reports the thread's context window only when its first turn ends, and the compaction line is worked out from it.

Wait for the turn to end, then click the composer chip again. A context bar has appeared between the switches and the status line: it runs from 0 to the thread's context window, filled to the context now, with the compaction line on its handle. The composer chip reads `≥ {line}`.

## 4. Choose the line

Drag the handle along the bar. It stops at the thread's ten settings; a higher one compacts only bigger threads. Or click the size on the handle, type one such as `500k`, and press Enter: it snaps to the nearest setting.

From now on, when this thread's turn ends at or above that line, Cache Keeper sends it `/compact` a minute before its prompt cache goes cold. [When Cache Keeper acts](../explanation/cache-keeper-timing.md) says why the line sits where it does.

## 5. Read the status line and Details

The status line reads `Now {context} · {status}`. With a short thread it reads something like `Now 30k · Idle, under the line`: the thread is idle and its context is below the line, so nothing will be sent. While the thread works it reads `Working`; once a compaction is due, `Compacting in {m}m`.

Click **Details**. It holds:

- the model, the cache lifetime and the calls per message the line rests on, `(default)` where Cache Keeper has not measured the thread yet;
- **Why {line}?**: what compacting costs at the line, and what it saves on your first message back after the cache goes cold.

`Idle, no line` means the thread has no line: bb has not reported its window yet, or no size up to its window repays compacting. In the second case **Details** shows **Why never?** in place of **Why {line}?**.

## 6. Switch Keep warm while waiting on for a tree

In a thread of your project, send:

```text
Spawn one child thread that runs `sleep 1800` in the background and waits for it, then wait for the child.
```

Once both have ended their turns, click the parent's composer chip and turn on **Keep warm while waiting**. The switch sits on the tree top, the topmost Claude Code thread, and covers every thread below it. Open the child and click its composer chip: its switch is greyed out, with "Set on {parent's title}" under it, which opens the parent.

Both show straight away that the tree is kept warm:

- the banner above each composer reads `Waiting on …, keeping cache warm`;
- hovering either composer chip ends "While it waits, its cache is kept warm."

The first keep-warm goes a minute before a thread's cache would go cold: about 4 minutes after its last request on a 5-minute cache, about 59 minutes after on a 1-hour cache. The popover's **Details** shows which lifetime the thread has. The keep-warm appears in the thread as a message from you, and on the Cache Keeper page's recent list. You needn't wait for it to carry on.

The same from a terminal, with the parent's id (`thr_…`) from its URL:

```sh
bb cache-keeper keep-warm on thr_…
```

## 7. Look at Agent tools

Open Settings → Plugins → Cache Keeper. Below the settings, the **Agent tools** section has one row, **Compact when idle**, off. While it is off, no agent can switch Compact when idle on for its own thread. Leave it off for now; [the reference](../reference/cache-keeper-settings.md#agent-tools) says what switching it on does.

## 8. Find what happened

Click **Cache Keeper** in the sidebar. The page lists the threads with Compact when idle on, the threads waiting now, what was sent recently, and totals for the last 30 days. Once the first keep-warm from step 6 has gone, it is in the recent list with its cost.

In a terminal:

```sh
bb cache-keeper status
bb cache-keeper status thr_…
```

The first lists every thread with Compact when idle on and the totals. The second shows one thread: its line, context and status, and what Cache Keeper last sent or held back, and why.

You have installed Cache Keeper, switched each of its switches on where you wanted it, and found what it did. To switch Compact when idle on from a terminal or let an agent do it, see [compact a thread when it goes idle](../how-to/cache-keeper-compact-a-thread.md).
