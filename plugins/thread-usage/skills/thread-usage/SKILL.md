---
name: thread-usage
description: Reports what a bb thread and the threads it spawned cost, in tokens and dollars. Use when asked about a thread's spend or token use, or before spawning threads when cost matters.
---

# Thread usage

Call `thread_usage` for this thread. `bb thread-usage show [<threadId>]` reports any
thread, and `bb thread-usage top` lists the most expensive trees; `--help` on
either prints its options.

Reading the numbers:

- Cost comes from three sources: `gateway` is what your AI gateway billed and
  is exact; `harness` is the cost the harness reported; `estimate` is tokens
  times public list price.
- `pricesUpdatedAt` says when those list prices were last refreshed; null means
  never, and the bundled list is in use.
- `unpriced` tokens have no price. They are not free.
- Billing `subscription` means the plan is not billed per token: report the
  tokens, and give dollars only as a list-price equivalent.
- Forks are not part of a tree total. Deleted child threads still are.
