# Cache Keeper

Keeps idle Claude Code threads in [bb](https://getbb.app) cheap to come back to. A thread's prompt cache lasts 5 minutes or 1 hour; come back after it expires and your first message rewrites the whole context into the cache and reads it again on every call after. Cache Keeper acts in the minute before that, and only once a thread's turn has ended.

- **Compact when idle**, switched on per thread from its composer chip: a thread that stops at or above its compaction line is sent `/compact` just before its cache goes cold, so the compaction reads a warm cache and your next message starts from the summary.
- **Keep warm while waiting**, switched per thread tree from the composer chip on its topmost Claude Code thread, the banner or `bb cache-keeper keep-warm`: a thread in a tree switched on whose turn ends while it waits on a background command, a subagent, a child thread or a scheduled message is kept warm until it wakes. By default no tree is kept warm until you switch it on; a setting can keep every waiting thread warm, or none.
- **Check-ins**, off until you switch them on in Settings, then on every Claude Code thread, whatever its tree's switch: a background task that stops printing gets a check-in asking the agent to check it and report what it finds.

It sends nothing on a fresh install until you switch something on. Its spend fails closed: a model with no price gets no keep-warms, and one whose cost cannot be measured counts at its forecast. Agents can use its tool only once you switch it on under **Agent tools**, and an agent can reach only threads in its own thread tree through `bb cache-keeper`. `bb cache-keeper status <thread>` says what it last did, and why it held back. Uninstalling keeps its `data.db`, and installing it again [switches every switch off](../../docs/reference/cache-keeper-settings.md#after-a-reinstall).

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin cache-keeper
```

- [First run](../../docs/tutorials/cache-keeper-first-run.md)
- [Compact a thread when it goes idle](../../docs/how-to/cache-keeper-compact-a-thread.md)
- [When Cache Keeper acts](../../docs/explanation/cache-keeper-timing.md): the deadline, the compaction line, waiting and the cost stop
- [Settings, surfaces and messages](../../docs/reference/cache-keeper-settings.md)
- [`bb cache-keeper` and the agent tool](../../docs/reference/cache-keeper-cli.md)
- [Install, update or remove a plugin](../../docs/how-to/install-plugins.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code, including the LiteLLM price list, is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
