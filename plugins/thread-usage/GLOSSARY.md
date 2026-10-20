# Thread Usage

The plugin that reports per-thread usage and cost, rolled up over child threads.

## Language

**Header chip**:
Thread Usage's coin in an outlined button in a thread's header, beside bb's editor picker, whose hover card shows the thread tree's cost and whose click opens its Usage tab.
_Avoid_: Chip, Usage chip, coin button

**Prompt size**:
A request's uncached input plus its cache reads plus its cache writes, which a tier's size is measured against. Output is not part of it.
_Avoid_: Context size, request size

**Tier**:
The set of rates that replace a model's base rates for a whole request, output included, once the request's prompt size is over a size models.dev publishes for that model.
_Avoid_: Long-context price, premium rate
