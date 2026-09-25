# OpenAI-compatible inference

A [bb](https://getbb.app) plugin that answers bb's helper inference, the calls that title new threads and write commit messages, through OpenAI Chat Completions. Each endpoint you list, a LiteLLM gateway or a local server such as mlx_lm.server, LM Studio or llama.cpp, becomes a service bb can use. An endpoint's URL and key can reference bb's environment, as in `${GATEWAY_URL}`.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin openai-inference
bb plugin config openai-inference set endpoints '[{"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}"}]'
bb-app config set BB_INFERENCE gateway/gpt-6-luna
```

- [First run: title threads through your gateway](../../docs/tutorials/openai-inference-first-run.md)
- [Title threads with a local model](../../docs/how-to/openai-inference-local-server.md)
- [Endpoints, settings and error codes](../../docs/reference/openai-inference-settings.md)
- [How a helper completion is sent](../../docs/explanation/openai-inference-requests.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). The packages bundled into `dist/` are listed with their licences in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
