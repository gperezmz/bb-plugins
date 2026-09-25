# OpenAI-compatible inference: first run

In this tutorial you install OpenAI-compatible inference, point bb's helper completions at your LiteLLM gateway, and watch a new thread get its title from the gateway. You need a bb server you can install plugins on, a LiteLLM gateway that serves `/v1/chat/completions`, a virtual key for it, and the name of a model it serves, `gpt-6-luna` in the commands below.

## 1. Install it

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin openai-inference
```

The plugin has no endpoints yet, so `bb settings ai-services` still lists only bb's own services.

## 2. Put the gateway in bb's environment

The plugin reads the gateway's URL and key from bb's environment, so neither is written in its settings. If `GATEWAY_URL` and `GATEWAY_VIRTUAL_KEY` are already there, as on a workstation set up for them, go to step 3.

Otherwise, under Settings → Environment variables, with the global scope, add:

- `GATEWAY_URL`: the gateway's base URL up to `/v1`, for example `https://gateway.example.com/v1`.
- `GATEWAY_VIRTUAL_KEY`: your virtual key.

and press **Save variables**. The page keeps the values secret, and bb hands them to its daemon without a restart.

## 3. Add the gateway as an endpoint

Add an [endpoint](../reference/openai-inference-settings.md#endpoints) called `gateway` that references both variables:

```sh
bb plugin config openai-inference set endpoints '[{"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}"}]'
bb plugin reload openai-inference
bb settings ai-services
```

The single quotes keep your shell from expanding `${GATEWAY_URL}` itself: the plugin expands it, for each request, and stores only the reference. The reload lets the plugin see variables added in step 2. The list of registered services now has `gateway  OpenAI-compatible endpoint at ${GATEWAY_URL}`.

If it does not, `bb plugin logs openai-inference` names the variable the plugin could not find, and [environment variables](../reference/openai-inference-settings.md#environment-variables) says where bb must have it.

## 4. Select the gateway

```sh
bb-app config set BB_INFERENCE gateway/gpt-6-luna
bb settings ai-services
```

The first line of the second command reads `BB_INFERENCE gateway/gpt-6-luna`. bb applies it without a restart.

## 5. Start a thread

Start a thread in any project, with a prompt of a sentence or more, for example:

```text
Find out why the settings page loads slowly and suggest a fix.
```

Within a few seconds the sidebar shows a short title in place of the start of your prompt. It came from the gateway: the gateway's request log shows a `/chat/completions` call for `gpt-6-luna` from your key.

## 6. If the title does not appear

bb logs each failed title to its server log with an error code. On the server machine:

```sh
grep 'Thread metadata inference' ~/.bb/logs/server.1.log | tail -n 1
```

The `errorCode` and `errorMessage` fields say what went wrong; [error codes](../reference/openai-inference-settings.md#error-codes) lists each code with its causes. Fix the setting it names and start another thread.

## Undo

To go back to the service you used before, set `BB_INFERENCE` to it again, for example:

```sh
bb-app config set BB_INFERENCE codex/gpt-5.6-luna
```

[Endpoints, settings and error codes](../reference/openai-inference-settings.md) lists every setting, and [how a helper completion is sent](../explanation/openai-inference-requests.md) explains what the plugin asks the gateway for.
