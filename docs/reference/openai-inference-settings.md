# OpenAI-compatible inference: endpoints, settings and error codes

Source: [`server.ts`](../../plugins/openai-inference/server.ts) for the settings and services, [`src/endpoints.ts`](../../plugins/openai-inference/src/endpoints.ts) for how the endpoints are read, [`src/complete.ts`](../../plugins/openai-inference/src/complete.ts) for the error codes.

## Endpoints

An **endpoint** is one OpenAI-compatible server, a LiteLLM gateway or a local server alike, with an id, a base URL and an optional key. Each endpoint is an AI service with its id, so `BB_INFERENCE` and `BB_INFERENCE_FALLBACK` can each name a different one:

```sh
bb-app config set BB_INFERENCE mlx/qwen3.5-2b
bb-app config set BB_INFERENCE_FALLBACK gateway/gpt-6-luna
```

`bb settings ai-services` lists the endpoints as `OpenAI-compatible endpoint at <url>`, beside bb's own services, with both values.

The part after the `/` is the model name the server lists at `GET <url>/models`. bb reads each value as exactly one `/` between service and model, so a model name that contains `/` cannot be selected. A LiteLLM `model_name` or a llama.cpp `--alias` gives such a model a name without one.

Every endpoint is sent the same request; [how a helper completion is sent](../explanation/openai-inference-requests.md) says what it holds.

### `gateway` from the environment

When bb was started with `GATEWAY_URL` in its environment and `endpoints` lists no endpoint called `gateway`, the plugin adds one:

| Field | Value |
|---|---|
| id | `gateway` |
| url | `GATEWAY_URL` |
| key | `gateway` in `keys`, else `GATEWAY_VIRTUAL_KEY`, else none |

An endpoint called `gateway` in `endpoints` replaces it. The variables are the ones bb was started with, so a change to them applies after bb restarts.

## Settings

Set these under Settings → Installed plugins → OpenAI-compatible inference, or with `bb plugin config openai-inference set <key> <value>`.

| Key | Label | Default | Meaning |
|---|---|---|---|
| `endpoints` | Endpoints | `[]` | JSON list of `{"id": ..., "url": ...}`, one per endpoint |
| `keys` | Endpoint keys | not set | JSON object from endpoint id to the key sent to it as `Authorization: Bearer <key>`; secret. An endpoint without one gets no `Authorization` header, except `gateway`, above |

For example:

```json
[
  {"id": "mlx", "url": "http://127.0.0.1:8080/v1"},
  {"id": "gateway", "url": "https://gateway.example.com/v1"}
]
```

```json
{"gateway": "sk-..."}
```

An id is lowercase letters, digits and dashes, appears once, and must not be the id of a service bb already has, such as `codex`, nor of a provider bb calls itself, such as `openai` or `anthropic`. bb refuses the first kind, and the plugin logs a warning; bb never sends the second kind to the plugin. A url is `http://` or `https://` and ends where `/chat/completions` starts; a trailing `/` is ignored. The settings page refuses a value that breaks these rules.

A saved change applies at once: endpoints added are registered, endpoints removed are unregistered, and the next completion uses the new url and key. No reload is needed.

## Error codes

Every failed completion returns one of bb's six codes. bb's server log (`~/.bb/logs/server.1.log` by default) shows it as `errorCode`, prefixed `ai_service_` (`ai_service_unavailable` for `service_unavailable`), with the message as `errorMessage`; a `timeout` shows as an inference timeout instead. bb retries with `BB_INFERENCE_FALLBACK` only after `timeout`, `rate_limited` and `service_unavailable`.

| Code | When |
|---|---|
| `auth_required` | HTTP 401 or 403: a missing, wrong or expired key |
| `rate_limited` | HTTP 429 |
| `timeout` | HTTP 408, or no answer within the time bb allows (5 seconds for a title or a commit message) |
| `service_unavailable` | HTTP 500 and above, or the server cannot be reached |
| `request_failed` | Any other HTTP status, such as 400 for an unknown model, 404 for a wrong URL, or 422 for a LiteLLM budget that is spent; an id the plugin has no endpoint for; a transcription request |
| `invalid_response` | The answer is not a chat completion, holds no JSON object, or lacks a key the schema requires |

A 400 or 422 is first taken as the server refusing an optional field, and the request is sent again without it; the code above is for the answer to the last request. [Fields a server refuses](../explanation/openai-inference-requests.md#fields-a-server-refuses) says which fields.

## What stays after uninstalling

`bb plugin uninstall openai-inference` deletes the settings. It leaves `plugins/openai-inference/host-data/endpoints.json` in the data directory of bb on the server machine (`~/.bb` by default): a copy of the endpoints that holds the keys, readable only by bb's user. Delete that folder after uninstalling.
