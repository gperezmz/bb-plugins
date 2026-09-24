---
name: thread-usage
description: Reports what a bb thread and every thread it spawned cost, in tokens and dollars. Use when asked about a thread's spend, token use or budget, or before spawning more threads when cost matters.
---

# Thread usage

The `thread_usage` tool returns this thread's family total: this thread plus
every thread spawned under it, with the cost split by source (`gateway`,
`harness`, `estimate`) and the billing mode. Call it to check your own spend.

From a shell:

- `bb thread-usage show [<threadId>] [--no-children] [--json]` shows one
  thread; without an id it shows the current thread.
- `bb thread-usage top [--project <id>] [--since 7d] [--limit 20] [--json]`
  lists the most expensive thread families (20 by default, at most 200).

How to read the numbers:

- `gateway` cost is what your AI gateway billed and is exact. `estimate` is
  tokens times public list price; `pricesUpdatedAt` says when those prices were last refreshed (null: never, bundled list in use). `unpriced` tokens have no price; they are not free.
- Billing `subscription` means the plan is not billed per token: report the
  tokens, and give dollars only as a list-price equivalent.
- Forks are not part of a family total. Deleted child threads still are.
