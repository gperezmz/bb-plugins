# Compact a thread when it goes idle

For a long Claude Code thread you will come back to later. Cache Keeper then compacts it a minute before its prompt cache expires, whenever its turn ends at or above the line.

1. In the thread, click the Cache Keeper chip at the right of the composer's action row, and turn on **Compact when idle**. The chip now reads `≥ {line}`, or `no line` until bb reports the thread's context window, which it does once the thread's first turn ends.
2. Move the line: drag the handle on the context bar, or click the size on it and type one, such as `500k`. The handle stops only at the thread's ten settings; a higher one compacts only bigger threads. **Why {line}?** shows what compacting costs at that size and what it saves on your first message back.

Or from a terminal:

```sh
bb cache-keeper on thr_… --above 500k
```

It snaps `500k` to the nearest of the thread's ten lines and prints the one it set. It refuses, and changes nothing, while the thread's window is unknown, or for a size above the thread's highest line.

While a compaction is due, the banner above the composer counts down. **Skip** leaves the thread alone until it next runs; **Compact now**, or `bb cache-keeper compact-now thr_…`, does it at once. To stop, turn the switch off or run `bb cache-keeper off thr_…`.

To let the thread's agent switch it on itself, turn on **Compact when idle** under Settings → Plugins → Cache Keeper → Agent tools; the agent gets the tool when its session next starts or resumes.

The line and when it fires are worked out in [when Cache Keeper acts](../explanation/cache-keeper-timing.md); every command is in [`bb cache-keeper`](../reference/cache-keeper-cli.md).
