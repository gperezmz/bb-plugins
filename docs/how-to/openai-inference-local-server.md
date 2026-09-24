# Title threads with a local model

Send bb's helper completions to a model on your own machine through the `local` service. It works with any server that serves OpenAI Chat Completions: mlx_lm.server, LM Studio, llama.cpp's `llama-server`, vLLM and others. The server must run where bb's daemon on the server machine can reach it, usually that same machine.

## 1. Start the server and find the model's name

Start the server with the model loaded, then list what it serves:

```sh
curl http://127.0.0.1:8080/v1/models
```

The `id` of the model is the name to select. bb splits `BB_INFERENCE` at its only `/`, so a model whose `id` contains `/` cannot be selected: load it under a name without one, as `llama-server --alias` does.

## 2. Point the plugin at it

```sh
bb plugin config openai-inference set localUrl http://127.0.0.1:8080/v1
```

The base URL ends where `/chat/completions` starts. If the server asks for a key, paste it into **Local server API key** under Settings → Installed plugins → OpenAI-compatible inference.

## 3. Select it

```sh
bb-app config set BB_INFERENCE local/<model>
```

with the model's `id` from step 1. Start a thread to see a title from it.

## Keep it within bb's time limit

bb gives a title 5 seconds, and a commit message the same. A model that is slower than that, or that thinks at length before it answers, returns `timeout`, and bb then tries `BB_INFERENCE_FALLBACK`. The plugin asks the model not to think and caps the answer at 256 tokens ([reasoning effort](../explanation/openai-inference-requests.md#reasoning-effort) says how), but a model whose chat template has no switch for thinking thinks anyway. Choose a small model that answers without thinking, or one whose template honours `enable_thinking`, and keep it loaded, so the first title does not wait for it to load.
