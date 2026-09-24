# Set price overrides and model aliases

Estimates use public list prices. Override them when your models are billed at other rates, when a model has no public price, or when a harness reports a model name the lists do not know. [Price sources](../reference/thread-usage-cost-sources.md#price-sources) gives the order in which prices are looked up.

## Write the JSON

The **Price overrides and aliases** setting takes one JSON object with two optional keys:

```json
{
  "aliases": { "claude-opus-5": "claude-opus-5-5" },
  "prices": {
    "my-internal-model": { "input": 1, "output": 4 },
    "claude-opus-5-5": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25, "cacheWrite1h": 10 }
  }
}
```

- `aliases` maps the model name a harness reports to the name to price it as. Aliases apply first, so an alias can point at a model you also override.
- `prices` sets rates in **US dollars per million tokens**. `input` and `output` are required; `cacheRead`, `cacheWrite` (5-minute cache writes) and `cacheWrite1h` are optional.

The rates above are examples, not real prices.

## Save it

Paste the JSON into Settings → Installed plugins → Thread Usage → **Price overrides and aliases**. Invalid JSON, or a price missing `input` or `output`, is refused with the reason.

From a shell, write it to a file and pass its contents:

```sh
bb plugin config thread-usage set priceOverrides "$(cat prices.json)"
```

Overrides take effect at once, and every past estimated turn of that model is priced again with them. Turns priced by the gateway or the harness do not change.

## Check it

Open the Usage tab of a thread that used the model. In **By model**, the tooltip on its cost names the price source: **Your price override**.

An override also changes the list-price equivalent of subscription use; [price sources](../reference/thread-usage-cost-sources.md#price-sources) has the order.
