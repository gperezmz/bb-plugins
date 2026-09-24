# Connect a LiteLLM gateway for exact cost

Without a gateway, Thread Usage estimates cost from tokens and public prices. With a [LiteLLM](https://docs.litellm.ai/) proxy in front of your models, it reads what each thread's requests actually cost there, under your own prices and aliases. [Gateways](../explanation/thread-usage-counting.md#gateways) explains how requests are matched to threads.

## 1. Ask the gateway operator for four things

If you run the gateway yourself, these are its settings; otherwise send this list to whoever does.

1. **Reach.** `GET /spend/logs/v2` must be reachable from the bb server. `GET /model/info` is optional and gives the plugin the gateway's price map. A reverse proxy in front of LiteLLM must forward `/spend/*`, and `/model/info` if used.
2. **A read key.** One key for the plugin with the role `proxy_admin_viewer`: read-only, but it sees every spend row in the deployment, so it stays on the bb server. The narrower choice is an `internal_user` key, which sees only rows of keys owned by the same LiteLLM user; it works only if every key your harnesses use belongs to that user.
3. **Spend logs on.** Leave `disable_spend_logs` unset. `store_prompts_in_spend_logs: false` is fine; the plugin never reads prompts. Retention can be short, since the plugin keeps its own copy of each row.
4. **The session header accepted.** LiteLLM accepts `x-litellm-session-id` by default. Nothing in front of the gateway may add an `x-litellm-trace-id` header, because LiteLLM reads that one first and the thread's id would be lost.

## 2. Configure the plugin

Under Settings → Installed plugins → Thread Usage:

1. Set **Gateway adapter** to `litellm`.
2. Set **Gateway URL** to the proxy's base URL, for example `https://llm.example.com`.
3. Paste the key into **Gateway read key**.
4. Press **Test connection**. Each of its four checks should pass; the last one warns until a tagged thread has run.

The same, except the key, from a shell:

```sh
bb plugin config thread-usage set adapter litellm
bb plugin config thread-usage set gatewayUrl https://llm.example.com
```

A key with a role that may not read spend gets `401` from `/spend/logs/v2`; **Test connection** reports that as its third check.

## 3. Tag each harness's requests

**Claude Code** needs nothing. The plugin sets `ANTHROPIC_CUSTOM_HEADERS` to `x-litellm-session-id: bb-<threadId>` for every command bb runs. That value replaces any `ANTHROPIC_CUSTOM_HEADERS` your shell sets, so if you already send headers that way, list them under **Extra Claude Code headers**. Turning the adapter on or off changes Claude Code's environment, so bb starts each thread's session afresh on its next turn and shows "Execution settings changed".

**Codex** and **pi** read their gateway settings from their own config. The plugin gives each command `BB_USAGE_SESSION=bb-<threadId>`; add one line so the harness sends it. The settings page shows both lines with a copy button.

Codex, in `~/.codex/config.toml`, inside the `[model_providers.<id>]` table of your gateway:

```toml
env_http_headers = { "x-litellm-session-id" = "BB_USAGE_SESSION" }
```

Codex must use the gateway as its model provider for its requests to be there at all.

pi, in `~/.pi/agent/models.json`, inside your gateway provider:

```json
"headers": { "x-litellm-session-id": "!printf %s \"${BB_USAGE_SESSION:-none}\"" }
```

The `printf` form keeps pi working outside bb, where the variable is unset.

Add the lines on every machine where these harnesses run.

**Cursor**, run through ACP, cannot be pointed at a custom gateway. Its threads show no tokens and no cost.

## 4. Check a thread

Run one turn in a thread on each harness, wait about a minute after it goes idle, and open its Usage tab. The headline's source should read **gateway**. A thread that reads **Requests are not tagged** is missing its config line; the note shows the line to add.

Spend lands in LiteLLM a few seconds after each request, and the plugin sweeps the gateway every minute while threads run and 20 seconds after one goes idle.
