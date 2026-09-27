# Cache Keeper

Keeps idle Claude Code threads in [bb](https://getbb.app) cheap to come back to. A thread's prompt cache lasts 5 minutes or 1 hour; come back after it expires and your first message rewrites the whole context into the cache and reads it again on every call after. Cache Keeper acts in the minute before that, and only once a thread's turn has ended.

- **Compact when idle**, switched on per thread from the chip in its composer: a thread that stops at or above its compaction line is sent `/compact` just before its cache goes cold, so the compaction reads a warm cache and your next message starts from the summary.
- **Keep-warms and check-ins**, on every Claude Code thread: a thread whose turn ends while it waits on a background command, a subagent, a child thread or a scheduled message is kept warm until it wakes, and a background task that stops printing gets a check-in asking the agent to fix it and carry on.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin cache-keeper
```

- [Compact a thread when it goes idle](../../docs/how-to/cache-keeper-compact-a-thread.md)
- [When Cache Keeper acts](../../docs/explanation/cache-keeper-timing.md): the deadline, the compaction line, waiting and the cost stop
- [Settings, surfaces and messages](../../docs/reference/cache-keeper-settings.md)
- [`bb cache-keeper` and the agent tool](../../docs/reference/cache-keeper-cli.md)
- [Install, update or remove a plugin](../../docs/how-to/install-plugins.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code, including the LiteLLM price list, is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
