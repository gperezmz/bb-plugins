# OpenAI-compatible inference: first run

In this tutorial you install OpenAI-compatible inference, point bb's helper completions at your LiteLLM gateway, and watch a new thread get its title from the gateway. You need a bb server you can install plugins on, a LiteLLM gateway that serves `/v1/chat/completions`, a virtual key for it, and the name of a model it serves, `gpt-6-luna` in the commands below.

## 1. Install it

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin openai-inference
bb settings ai-services
```

The list of registered services now has `gateway` and `local` beside `codex`. `BB_INFERENCE` still names the service bb used before.

## 2. Tell it where the gateway is

If bb was started with `GATEWAY_URL` and `GATEWAY_VIRTUAL_KEY` in its environment, skip this step: the plugin reads them.

Otherwise set the URL and the key in the plugin's settings. The URL is the gateway's base URL up to `/v1`:

```sh
bb plugin config openai-inference set gatewayUrl https://gateway.example.com/v1
```

Paste the key into **Gateway virtual key** under Settings → Installed plugins → OpenAI-compatible inference. The key is a secret setting: bb keeps it out of its database and out of the browser.

## 3. Select the gateway

```sh
bb-app config set BB_INFERENCE gateway/gpt-6-luna
bb settings ai-services
```

The first line of the second command reads `BB_INFERENCE gateway/gpt-6-luna`. bb applies it without a restart.

## 4. Start a thread

Start a thread in any project, with a prompt of a sentence or more, for example:

```text
Find out why the settings page loads slowly and suggest a fix.
```

Within a few seconds the sidebar shows a short title in place of the start of your prompt. It came from the gateway: the gateway's request log shows a `/chat/completions` call for `gpt-6-luna` from your key.

## 5. If the title does not appear

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

[Services, settings and error codes](../reference/openai-inference-settings.md) lists every setting, and [how a helper completion is sent](../explanation/openai-inference-requests.md) explains what the plugin asks the gateway for.
