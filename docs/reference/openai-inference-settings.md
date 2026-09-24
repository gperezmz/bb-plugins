# OpenAI-compatible inference: services, settings and error codes

Source: [`server.ts`](../../plugins/openai-inference/server.ts) for the services and settings, [`src/endpoint.ts`](../../plugins/openai-inference/src/endpoint.ts) for how an endpoint is chosen, [`src/complete.ts`](../../plugins/openai-inference/src/complete.ts) for the error codes.

## Services

Select a service with `bb-app config set BB_INFERENCE <service>/<model>`. `bb settings ai-services` lists the services and the current value.

| Service | Shown as | For | Base URL | Key |
|---|---|---|---|---|
| `gateway` | LiteLLM gateway (OpenAI-compatible) | A LiteLLM gateway | `gatewayUrl`, else `GATEWAY_URL` | `gatewayKey`, else `GATEWAY_VIRTUAL_KEY` |
| `local` | Local OpenAI-compatible server | mlx_lm.server, LM Studio, llama.cpp and the like | `localUrl` | `localKey`, or none |

`<model>` is the model name the server lists at `GET <base URL>/models`. bb reads `BB_INFERENCE` as exactly one `/` between service and model, so a model name that contains `/` cannot be selected. A LiteLLM `model_name` or a llama.cpp `--alias` gives such a model a name without one.

Both services ask for `reasoning_effort: "none"` differently; [reasoning effort](../explanation/openai-inference-requests.md#reasoning-effort) says how.

## Settings

Set these under Settings → Installed plugins → OpenAI-compatible inference, or with `bb plugin config openai-inference set <key> <value>`.

| Key | Label | Default | Meaning |
|---|---|---|---|
| `gatewayUrl` | Gateway base URL | empty | Base URL for `gateway`. Empty uses `GATEWAY_URL` |
| `gatewayKey` | Gateway virtual key | not set | Bearer token for `gateway`; secret. Not set uses `GATEWAY_VIRTUAL_KEY` |
| `localUrl` | Local server base URL | empty | Base URL for `local`. Empty leaves `local` unusable |
| `localKey` | Local server API key | not set | Bearer token for `local`; secret. Not set sends no `Authorization` header |

A base URL is `http://` or `https://`, and ends where `/chat/completions` starts: `https://gateway.example.com/v1` is sent to `https://gateway.example.com/v1/chat/completions`. A trailing `/` is ignored.

A saved setting applies to the next completion, without a reload.

## Environment variables

Read from the environment of bb's daemon on the server machine, which the host entry inherits.

| Variable | Used for |
|---|---|
| `GATEWAY_URL` | `gateway`'s base URL when `gatewayUrl` is empty |
| `GATEWAY_VIRTUAL_KEY` | `gateway`'s Bearer token when `gatewayKey` is not set |

## Error codes

Every failed completion returns one of bb's six codes. bb's server log (`~/.bb/logs/server.1.log` by default) shows it as `errorCode`, prefixed `ai_service_` (`ai_service_unavailable` for `service_unavailable`), with the message as `errorMessage`; a `timeout` shows as an inference timeout instead. bb retries with `BB_INFERENCE_FALLBACK` only after `timeout`, `rate_limited` and `service_unavailable`.

| Code | When |
|---|---|
| `auth_required` | HTTP 401 or 403: a missing, wrong or expired key |
| `rate_limited` | HTTP 429 |
| `timeout` | HTTP 408, or no answer within the time bb allows (5 seconds for a title or a commit message) |
| `service_unavailable` | HTTP 500 and above, or the server cannot be reached |
| `request_failed` | Any other HTTP status, such as 400 for an unknown model, 404 for a wrong URL, or 422 for a LiteLLM budget that is spent; a service with no base URL; a transcription request |
| `invalid_response` | The answer is not a chat completion, holds no JSON object, or lacks a key the schema requires |

A 400 or 422 is first taken as the server refusing an optional field, and the request is sent once more without it; the code above is for the answer to that second request. [Structured output](../explanation/openai-inference-requests.md#structured-output) says which fields.

## What stays after uninstalling

`bb plugin uninstall openai-inference` deletes the settings. It leaves `plugins/openai-inference/host-data/endpoints.json` in the data directory of bb on the server machine (`~/.bb` by default), a copy of the settings that holds the keys, readable only by bb's user. Delete that folder after uninstalling.
