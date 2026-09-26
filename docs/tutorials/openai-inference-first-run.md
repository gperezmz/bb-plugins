# OpenAI-compatible inference: first run

In this tutorial you install OpenAI-compatible inference, point bb's AI tasks at your LiteLLM gateway, and watch a new thread get its title from the gateway. You need bb 0.44 or later on a server you can install plugins on, a LiteLLM gateway that serves `/v1/chat/completions`, a virtual key for it, and the name of a model it serves, `gpt-6-luna` in the commands below.

## 1. Install it

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin openai-inference
```

The plugin has no Endpoints yet, so `bb settings ai-services` still lists only bb's own services.

## 2. Put the gateway in bb's environment

The plugin reads the gateway's URL and key from bb's environment, so neither is written in its settings. If `GATEWAY_URL` and `GATEWAY_VIRTUAL_KEY` are already there, as on a workstation set up for them, go to step 3.

Otherwise, under Settings → Environment variables, with the global scope, add:

- `GATEWAY_URL`: the gateway's base URL up to `/v1`, for example `https://gateway.example.com/v1`.
- `GATEWAY_VIRTUAL_KEY`: your virtual key.

and press **Save variables**. The page keeps the values secret, and bb hands them to its daemon without a restart.

## 3. Add the gateway as an Endpoint

Add an [Endpoint](../reference/openai-inference-settings.md#endpoints) called `gateway` that references both variables and names the model:

```sh
bb plugin config openai-inference set endpoints '[{"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}", "model": "gpt-6-luna"}]'
bb plugin reload openai-inference
bb settings ai-services
```

The single quotes keep your shell from expanding `${GATEWAY_URL}` itself: the plugin expands it, for each request, and stores only the reference. The reload lets the plugin see variables added in step 2. The list of AI services now has `gateway  OpenAI-compatible endpoint at ${GATEWAY_URL}`, and it is ready.

If it is marked not ready, the list says why. A missing variable is named, and [environment variables](../reference/openai-inference-settings.md#environment-variables) says where bb must have it. A missing `model` is refused when you save.

## 4. Select the gateway

bb's Automatic choice never picks an Endpoint, so select the gateway for the AI tasks it should do:

```sh
bb settings ai-services set thread-title gateway
bb settings ai-services set commit-message gateway
bb settings ai-services
```

The list shows the selection for each AI task. bb applies it without a restart. The same choice is under Settings → AI services.

## 5. Start a thread

Start a thread in any project, with a prompt of a sentence or more, for example:

```text
Find out why the settings page loads slowly and suggest a fix.
```

Within a few seconds the sidebar shows a short title in place of the start of your prompt. It came from the gateway: the gateway's request log shows a `/chat/completions` call for `gpt-6-luna` from your key.

## 6. If the title does not appear

bb has no fallback from `gateway` to another service, so a title the gateway cannot write is not written by anything else. Run:

```sh
bb settings ai-services
bb settings ai-services test thread-title
```

The first says whether the Endpoint is ready and, if not, why. The second sends a sample through the selected service; a request that fails reports a message that names the Endpoint. [Failures](../reference/openai-inference-settings.md#failures) lists each message with its causes. Fix the setting it names and start another thread; bb reads the Endpoint's status again within about 10 seconds.

## Undo

To go back to bb's own choice for an AI task, set it to Automatic, or to `off`:

```sh
bb settings ai-services set thread-title automatic
bb settings ai-services set commit-message automatic
```

[Endpoints, settings and failures](../reference/openai-inference-settings.md) lists every setting, and [how an AI task is sent](../explanation/openai-inference-requests.md) explains what the plugin asks the gateway for.
