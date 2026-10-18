# Title threads with a local model

Send bb's AI tasks to a model on your own machine. Any server that serves OpenAI Chat Completions works: mlx_lm.server, LM Studio, llama.cpp's `llama-server`, vLLM and others. The server must run where bb's daemon on the primary machine can reach it, usually that same machine.

## 1. Start the server and find the model's name

Start the server with the model loaded, then list what it serves:

```sh
curl http://127.0.0.1:8080/v1/models
```

The `id` of the model is the name to put in the Endpoint's `model`. A name with `/` in it is fine.

## 2. Add it as an Endpoint

Under Settings → Installed plugins → OpenAI-compatible inference, press **Add Endpoint** in the Endpoints section and fill the card:

- **ID**: one of your choice, `mlx` here. It cannot be changed once saved.
- **URL**: `http://127.0.0.1:8080/v1`, which ends where `/chat/completions` starts.
- **Model**: the name from step 1, `qwen3-4b` here.
- **Key**: **None** if the server asks for no key. If it does, choose **Literal** and type it into the masked field, or set it in bb's environment and choose **Variable** with its `${NAME}`.

Press **Save**. `bb settings ai-services` lists `mlx` at once; no reload is needed. To use a second model on the same server, add the server again under another ID with that model.

The command does the same without a literal key: `bb openai-inference set mlx --url http://127.0.0.1:8080/v1 --model qwen3-4b`. [The Endpoints section](../reference/openai-inference-settings.md#the-endpoints-section) lists what each field accepts, and [Literal keys](../reference/openai-inference-settings.md#literal-keys) says where a typed key is kept and when it is deleted.

## 3. Select it

```sh
bb settings ai-services set thread-title mlx
bb settings ai-services set commit-message mlx
```

Automatic never picks an Endpoint, so the selection is what makes bb use it. Start a thread to see a title from the local model.

bb has no fallback from a selected service to another. When the local server is stopped, or the model is not loaded, the AI task is not done and the thread keeps the start of your prompt as its title. To use a gateway when the local model is down, select the gateway instead: the [first run](../tutorials/openai-inference-first-run.md) adds one.

## Keep it within bb's time limit

bb gives a title 5 seconds, and a commit message the same, and then closes the request. A model that is slower than that, or that thinks at length before it answers, gets no answer through in time. The plugin asks the model not to think and caps the answer at 256 tokens ([what the request asks for](../explanation/openai-inference-requests.md#what-the-request-asks-for) says how), but a model whose chat template has no switch for thinking thinks anyway. Choose a small model that answers without thinking, or one whose template honours `enable_thinking`, and keep it loaded, so the first title does not wait for it to load.
