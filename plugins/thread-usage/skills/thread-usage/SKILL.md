---
name: thread-usage
description: Reports what a bb thread and the threads it spawned cost, in tokens and dollars. Use when asked about a thread's spend or token use, or before spawning threads when cost matters.
---

# Thread usage

Call `thread_usage` for this thread. `bb thread-usage show [<threadId>]` reports any
thread, and `bb thread-usage top` lists the most expensive trees; `--help` on
either prints its options.

Reading the numbers:

- Dollars are an estimate: tokens times the price models.dev lists, each
  request priced on its own prompt size. The cost has three amounts, `gateway`,
  `harness` and `estimate`; `gateway` and `harness` are always zero, so
  `estimate` is the total.
- `pricesUpdatedAt` says when that list was last fetched; null means never, and
  the bundled copy is in use.
- `unpriced` tokens have no price on models.dev. They are counted, not free, and
  a thread whose every token is unpriced leads with its token count.
- Billing `subscription` means the plan is not billed per token: report the
  tokens, and give dollars only as a list-price equivalent.
- Forks are not part of a tree total. Deleted child threads still are.
