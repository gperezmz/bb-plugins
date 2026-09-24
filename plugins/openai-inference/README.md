# OpenAI-compatible inference

A [bb](https://getbb.app) plugin that answers bb's helper inference, the calls that title new threads and write commit messages, through OpenAI Chat Completions. It adds two services: `gateway`, for a LiteLLM gateway, and `local`, for a local OpenAI-compatible server such as mlx_lm.server, LM Studio or llama.cpp.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin openai-inference
bb-app config set BB_INFERENCE gateway/gpt-6-luna
```

- [First run: title threads through your gateway](../../docs/tutorials/openai-inference-first-run.md)
- [Title threads with a local model](../../docs/how-to/openai-inference-local-server.md)
- [Services, settings and error codes](../../docs/reference/openai-inference-settings.md)
- [How a helper completion is sent](../../docs/explanation/openai-inference-requests.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). The packages bundled into `dist/` are listed with their licences in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
