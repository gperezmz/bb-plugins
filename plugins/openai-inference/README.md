# OpenAI-compatible inference

A [bb](https://getbb.app) plugin that does bb's AI tasks, the calls that title new threads and write commit messages, through OpenAI Chat Completions. Each Endpoint you list, a LiteLLM gateway or a local server such as mlx_lm.server, LM Studio or llama.cpp, becomes an AI service with the model you name for it. An Endpoint's URL and key can reference bb's environment, as in `${GATEWAY_URL}`. Needs bb 0.44 or later.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin openai-inference
bb plugin config openai-inference set endpoints '[{"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}", "model": "gpt-6-luna"}]'
bb settings ai-services set thread-title gateway
bb settings ai-services set commit-message gateway
```

bb's Automatic choice never picks an Endpoint, so select it for each AI task as above. bb does not fall back from a selected service to another one.

- [First run: title threads through your gateway](../../docs/tutorials/openai-inference-first-run.md)
- [Title threads with a local model](../../docs/how-to/openai-inference-local-server.md)
- [Endpoints, settings and failures](../../docs/reference/openai-inference-settings.md)
- [How an AI task is sent](../../docs/explanation/openai-inference-requests.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Upgrading from 0.1

0.2.0 needs bb 0.44 or later; on bb 0.43 the plugin stays at 0.1.4. `BB_INFERENCE` and `BB_INFERENCE_FALLBACK` are gone in 0.2.0, and with them the `<id>/<model>` value they took: the model now goes in the Endpoint's `model`. Your existing Endpoints show as not ready until each has a `model`, and each AI task needs its service selected again with `bb settings ai-services set`.

## Licence

MIT, see [`LICENSE`](LICENSE). The packages bundled into `dist/` are listed with their licences in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
