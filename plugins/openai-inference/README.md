# OpenAI-compatible inference

A [bb](https://getbb.app) plugin that does bb's AI tasks for thread titles and commit messages through OpenAI Chat Completions. Each Endpoint you add, a LiteLLM gateway or a local server such as mlx_lm.server, LM Studio or llama.cpp, becomes an AI service with the model you name for it. An Endpoint's URL and key can reference bb's environment, as in `${GATEWAY_URL}`, or the key can be typed into the plugin's page. Needs bb 0.46 or later.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin openai-inference
bb openai-inference set gateway --url '${GATEWAY_URL}' --model gpt-6-luna --key '${GATEWAY_VIRTUAL_KEY}'
bb settings ai-services set thread-title gateway
bb settings ai-services set commit-message gateway
```

Endpoints are cards under Settings → Installed plugins → OpenAI-compatible inference, where a key can also be typed in and kept; the command never takes a literal key. bb's Automatic choice never picks an Endpoint, so select it for each AI task as above. bb does not fall back from a selected service to another one.

- [First run: title threads through your gateway](../../docs/tutorials/openai-inference-first-run.md)
- [Title threads with a local model](../../docs/how-to/openai-inference-local-server.md)
- [Endpoints, the command and failures](../../docs/reference/openai-inference-settings.md)
- [How an AI task is sent](../../docs/explanation/openai-inference-requests.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Upgrading from 0.1

0.2.0 needs bb 0.44 or later; on bb 0.43 the plugin stays at 0.1.4. bb 0.44 removed `BB_INFERENCE` and `BB_INFERENCE_FALLBACK`, and with them the `<id>/<model>` value they took: the model now goes in the Endpoint's `model`. Your existing Endpoints show as not ready until each has a `model`, and each AI task needs its service selected again with `bb settings ai-services set`. The first time 0.2.0 starts it deletes `endpoints.json` from the plugin's `host-data` folder, where 0.1 kept the Endpoints and their keys.

## Upgrading from 0.3

Releases after 0.3 keep the Endpoints in the plugin's own storage and edit them in the Endpoints section of the plugin's page, not in the `endpoints` and `keys` settings, which `bb plugin config` no longer sets. The first start after the update copies the Endpoints and literal keys once, and an Endpoint stays selected for the AI tasks it was selected for. [Upgrading from 0.3](../../docs/reference/openai-inference-settings.md#upgrading-from-03) says what the copy does when it cannot read an old value, and what going back to 0.3 loses.

## Licence

MIT, see [`LICENSE`](LICENSE). The packages bundled into `dist/` are listed with their licences in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
