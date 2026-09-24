# Thread Usage: first run

In this tutorial you install Thread Usage, run a thread that spawns a child, and read what the two cost in the header, the Usage tab, the sidebar page and the CLI. You need a bb server you can install plugins on and one project with an agent that can run. No gateway is needed: costs here are estimates from public prices.

## 1. Install it

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-usage
```

Nothing changes on screen yet. The plugin starts recording each thread from its next event, and reads older threads' history from their harness logs in the background.

## 2. Run a thread with a child

In a thread of your project, send:

```text
Spawn one child thread that counts the lines in README.md, wait for it, then tell me the number.
```

Wait for the parent to finish.

## 3. Read the header chip

A coin has appeared in the thread's header. Hover it. The card shows the [family](../explanation/how-the-plugins-fit-bb.md#threads-and-families)'s [headline](../explanation/thread-usage-counting.md#billed-and-subscription-use), a bar of tokens by kind, and `1 child thread`: the figure covers the parent and its child.

If your agent runs on a subscription plan, the headline leads with tokens, and the dollars read **list-price equivalent**. With an API key it leads with dollars, labelled **estimate**. [Billed and subscription use](../explanation/thread-usage-counting.md#billed-and-subscription-use) explains the difference.

## 4. Open the Usage tab

Click the coin. The Usage tab opens in the thread's side panel:

- The headline, with a toggle between **This thread** and **With children**. Switch it and watch the figure change by what the child cost.
- **Tokens** by kind, and the share of input read from cache.
- **By model**. Hover a cost to see which price list it came from and when that list was fetched.
- **Cost per turn**. Click a bar to see that turn's prompt, model, tokens and cost.
- **Child threads**: your child, with its own cost and its share of the total. Click it to open the child.
- **Data quality**: anything missing or estimated, in words.

## 5. Ask from a shell

In a terminal, with the parent's id (`thr_…`) from its URL or from `bb thread list`:

```sh
bb thread-usage show <threadId>
bb thread-usage show <threadId> --no-children
```

The first matches the Usage tab's **With children**; the second, **This thread**.

## 6. See the most expensive families

Click **Thread usage** in the sidebar. The page ranks the most expensive thread families of the last 7 days; switch to 30 days, or pick a project at the top. The same list is in the CLI:

```sh
bb thread-usage top --since 30d
```

You have installed Thread Usage and read one family's cost in each place it shows. To get exact costs instead of estimates, [connect a LiteLLM gateway](../how-to/thread-usage-connect-litellm.md).
