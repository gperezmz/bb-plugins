# Thread Usage

A [bb](https://getbb.app) plugin that shows what a thread cost, in tokens and dollars, and adds up the cost of every thread it spawned. It works with any harness bb runs. Dollars are an estimate from models.dev's prices, each request priced on its own prompt size, including the higher tiers models.dev publishes for long prompts.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-usage
```

- [First run](../../docs/tutorials/thread-usage-first-run.md)
- [Settings](../../docs/reference/thread-usage-settings.md)
- [`bb thread-usage`](../../docs/reference/thread-usage-cli.md)
- [The `thread_usage` agent tool](../../docs/reference/thread-usage-agent-tool.md)
- [Cost sources, prices and billing](../../docs/reference/thread-usage-cost-sources.md)
- [How Thread Usage counts tokens and cost](../../docs/explanation/thread-usage-counting.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). The packages bundled into `dist/` and the price data are listed with their licences in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
