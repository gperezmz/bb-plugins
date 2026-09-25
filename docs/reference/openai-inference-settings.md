# OpenAI-compatible inference: endpoints, settings and error codes

Source: [`server.ts`](../../plugins/openai-inference/server.ts) for the settings and services, [`src/endpoints.ts`](../../plugins/openai-inference/src/endpoints.ts) for how the endpoints are read, [`src/complete.ts`](../../plugins/openai-inference/src/complete.ts) for the error codes.

## Endpoints

An **endpoint** is one OpenAI-compatible server, a LiteLLM gateway or a local server alike, with an id, a base URL and an optional key. Each endpoint is an AI service with its id, so `BB_INFERENCE` and `BB_INFERENCE_FALLBACK` can each name a different one:

```sh
bb-app config set BB_INFERENCE mlx/qwen3.5-2b
bb-app config set BB_INFERENCE_FALLBACK gateway/gpt-6-luna
```

`bb settings ai-services` lists the endpoints as `OpenAI-compatible endpoint at <url>`, with the url as written in the settings, references unexpanded.

The part after the `/` is the model name the server lists at `GET <url>/models`. bb reads each value as exactly one `/` between service and model, so a model name that contains `/` cannot be selected. A LiteLLM `model_name` or a llama.cpp `--alias` gives such a model a name without one.

Every endpoint is sent the same request; [how a helper completion is sent](../explanation/openai-inference-requests.md) says what it holds.

## Settings

Set these under Settings → Installed plugins → OpenAI-compatible inference, or with `bb plugin config openai-inference set <key> <value>`.

| Key | Label | Default | Meaning |
|---|---|---|---|
| `endpoints` | Endpoints | `[]` | JSON list of endpoints, each `{"id", "url", "key"}`; `key` is optional |
| `keys` | Endpoint keys | not set | JSON object from endpoint id to a literal key; secret |

For example, a local server with a literal key in `keys`, and a gateway whose URL and key come from bb's environment:

```json
[
  {"id": "mlx", "url": "http://127.0.0.1:8080/v1"},
  {"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}"}
]
```

```json
{"mlx": "sk-..."}
```

| Field | Rules |
|---|---|
| `id` | Lowercase letters, digits and dashes, once in the list. Not the id of a service bb already has, such as `codex`, which bb refuses and the plugin logs; nor of a provider bb calls itself, such as `openai` or `anthropic`, which bb never sends to the plugin |
| `url` | An `http://` or `https://` URL ending where `/chat/completions` starts, or text holding `${NAME}` references, whole (`${GATEWAY_URL}`) or embedded (`https://${GATEWAY_HOST}/v1`). A trailing `/` is ignored |
| `key` | Only a `${NAME}` reference. A literal key goes in `keys`, which the settings page keeps secret; the page refuses a literal key here and says so |

The key sent to an endpoint, as `Authorization: Bearer <key>`, is its entry in `keys`, else its `key` reference, else none.

A saved change applies at once: endpoints added are registered, endpoints removed are unregistered, and the next completion uses the new url and key. No reload is needed.

## Environment variables

A `${NAME}` is expanded by the plugin's host entry, in bb's daemon on the server machine, from that daemon's environment, for each request. The expanded value is not stored or logged: the plugin's files and bb's service list hold the reference, and error messages name the endpoint by its id.

An endpoint that references a variable which is unset or empty there is not registered, and `bb plugin logs openai-inference` says which, for example `Endpoint "gateway" is not registered: not set in bb's environment: GATEWAY_URL`.

| Where the variable is set | Reaches the endpoint | When a change applies |
|---|---|---|
| The environment bb was started with | Yes | When bb restarts |
| `bb machine env set NAME`, or Settings → Environment variables, global scope | Yes | After `bb plugin reload openai-inference`. Saving the plugin's settings again is not enough: the host entry may keep its previous environment |
| `bb machine env set NAME --project <id>`, or a project's scope | No | bb passes project variables to agent turns and commands only |

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

`bb plugin uninstall openai-inference` deletes the settings. It leaves the host entry's files in `plugins/openai-inference/host-data/`, in the data directory of bb on the server machine (`~/.bb` by default). Both are readable only by bb's user:

| File | Holds |
|---|---|
| `endpoints.json` | A copy of the endpoints, keys included |
| `learned-fields.json` | The [fields each endpoint URL and model refused](../explanation/openai-inference-requests.md#why-what-was-dropped-is-kept-in-a-file). No keys: URLs as the settings write them, model names and field names |

Delete that folder after uninstalling.
