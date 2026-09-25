# Title threads with a local model

Send bb's helper completions to a model on your own machine, and keep your gateway as the fallback. Any server that serves OpenAI Chat Completions works: mlx_lm.server, LM Studio, llama.cpp's `llama-server`, vLLM and others. The server must run where bb's daemon on the server machine can reach it, usually that same machine.

## 1. Start the server and find the model's name

Start the server with the model loaded, then list what it serves:

```sh
curl http://127.0.0.1:8080/v1/models
```

The `id` of the model is the name to select. bb splits `BB_INFERENCE` at its only `/`, so a model whose `id` contains `/` cannot be selected: load it under a name without one, as `llama-server --alias` does.

## 2. Add it as an endpoint

Under Settings → Installed plugins → OpenAI-compatible inference, add the server to **Endpoints** with an id of your choice, `mlx` here:

```json
[{"id": "mlx", "url": "http://127.0.0.1:8080/v1"}]
```

Keep any endpoints already in the list. The url ends where `/chat/completions` starts. If the server asks for a key, add it to **Endpoint keys** under the same id, for example `{"mlx": "..."}`. `bb settings ai-services` lists `mlx` once you save.

## 3. Select it, with the gateway as fallback

```sh
bb-app config set BB_INFERENCE mlx/<model>
bb-app config set BB_INFERENCE_FALLBACK gateway/gpt-6-luna
```

with the model's `id` from step 1, and a model your gateway serves. The second line needs a `gateway` endpoint, from `GATEWAY_URL` or listed as in the [first run](../tutorials/openai-inference-first-run.md#2-add-the-gateway-as-an-endpoint). Start a thread to see a title from the local model.

## Keep it within bb's time limit

bb gives a title 5 seconds, and a commit message the same. A model that is slower than that, or that thinks at length before it answers, returns `timeout`, and bb then tries `BB_INFERENCE_FALLBACK`. The plugin asks the model not to think and caps the answer at 256 tokens ([what the request asks for](../explanation/openai-inference-requests.md#what-the-request-asks-for) says how), but a model whose chat template has no switch for thinking thinks anyway. Choose a small model that answers without thinking, or one whose template honours `enable_thinking`, and keep it loaded, so the first title does not wait for it to load.
