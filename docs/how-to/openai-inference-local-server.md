# Title threads with a local model

Send bb's AI tasks to a model on your own machine. Any server that serves OpenAI Chat Completions works: mlx_lm.server, LM Studio, llama.cpp's `llama-server`, vLLM and others. The server must run where bb's daemon on the primary machine can reach it, usually that same machine.

## 1. Start the server and find the model's name

Start the server with the model loaded, then list what it serves:

```sh
curl http://127.0.0.1:8080/v1/models
```

The `id` of the model is the name to put in the Endpoint's `model`. A name with `/` in it is fine.

## 2. Add it as an Endpoint

Under Settings → Installed plugins → OpenAI-compatible inference, add the server to **Endpoints** with an id of your choice, `mlx` here, and the model from step 1:

```json
[{"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "qwen3-4b"}]
```

Keep any Endpoints already in the list. The url ends where `/chat/completions` starts. If the server asks for a key, add it to **Endpoint keys** under the same id, for example `{"mlx": "..."}`, or set it in bb's environment and reference it as the Endpoint's `"key": "${NAME}"`. `bb settings ai-services` lists `mlx` once you save. To use a second model on the same server, add the server again under another id with that model.

## 3. Select it

```sh
bb settings ai-services set thread-title mlx
bb settings ai-services set commit-message mlx
```

Automatic never picks an Endpoint, so the selection is what makes bb use it. Start a thread to see a title from the local model.

bb has no fallback from a selected service to another. When the local server is stopped, or the model is not loaded, the AI task is not done and the thread keeps the start of your prompt as its title. To use a gateway when the local model is down, select the gateway instead: the [first run](../tutorials/openai-inference-first-run.md#2-put-the-gateway-in-bbs-environment) adds one.

## Keep it within bb's time limit

bb gives a title 5 seconds, and a commit message the same, and then closes the request. A model that is slower than that, or that thinks at length before it answers, gets no answer through in time. The plugin asks the model not to think and caps the answer at 256 tokens ([what the request asks for](../explanation/openai-inference-requests.md#what-the-request-asks-for) says how), but a model whose chat template has no switch for thinking thinks anyway. Choose a small model that answers without thinking, or one whose template honours `enable_thinking`, and keep it loaded, so the first title does not wait for it to load.
