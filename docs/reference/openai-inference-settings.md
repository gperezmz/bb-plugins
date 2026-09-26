# OpenAI-compatible inference: endpoints, settings and failures

Source: [`server.ts`](../../plugins/openai-inference/server.ts) for the settings and services, [`src/endpoints.ts`](../../plugins/openai-inference/src/endpoints.ts) for how the Endpoints are read and when one is not ready, [`src/complete.ts`](../../plugins/openai-inference/src/complete.ts) for the failure messages.

## Endpoints

An **Endpoint** is one entry in the `endpoints` setting: an OpenAI-compatible server, a LiteLLM gateway or a local server alike, with an id, a base URL, the model it answers with and an optional key. Each Endpoint is one AI service with its Endpoint's id, offered for the `thread-title` and `commit-message` AI tasks and not for `voice`. To use two models on one server, list the server twice under two ids.

`bb settings ai-services` lists every Endpoint as `OpenAI-compatible endpoint at <url>`, with the url as written in the settings, references unexpanded.

Every Endpoint is listed, including one that cannot answer. That one is marked not ready, with the reason:

| Reason | Message |
|---|---|
| The Endpoint has no `model`, as in a setting saved before 0.2.0 | The Endpoint needs a model: add "model" to it in the endpoints setting. |
| A `${NAME}` in the `url`, or in the key in effect, is unset or empty in bb's environment on the primary machine | Not set in bb's environment: followed by every such variable |

Both messages appear together when both apply. Not ready is decided from the settings and bb's environment alone: the server is never called to find out.

### Selecting an Endpoint

Select an Endpoint for each AI task by its id:

```sh
bb settings ai-services set thread-title mlx
bb settings ai-services set commit-message gateway
bb settings ai-services test thread-title
```

The same choice is under Settings → AI services in the app. `test` runs a sample through the service now selected for a task.

- **Automatic never picks an Endpoint.** It chooses only among the services bb ships, so an Endpoint is used only after you select it.
- **bb has no fallback from one selected service to another.** When the selected service is not ready, or its request fails, bb does not try a second one, and the AI task is not done.
- **bb reads a service's status before every request.** It waits up to 2 seconds for the answer and keeps it for about 10, so a fix to a not ready Endpoint can take that long to show.

Every Endpoint is sent the same request; [how an AI task is sent](../explanation/openai-inference-requests.md) says what it holds.

## Settings

Set these under Settings → Installed plugins → OpenAI-compatible inference, or with `bb plugin config openai-inference set <key> <value>`.

| Key | Label | Default | Meaning |
|---|---|---|---|
| `endpoints` | Endpoints | `[]` | JSON list of Endpoints, each `{"id", "url", "model", "key"}`; `key` is optional |
| `keys` | Endpoint keys | not set | JSON object from Endpoint id to a literal key; secret |

For example, a local server with a literal key in `keys`, and a gateway whose URL and key come from bb's environment:

```json
[
  {"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "qwen3-4b"},
  {"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}", "model": "gpt-6-luna"}
]
```

```json
{"mlx": "sk-..."}
```

| Field | Rules |
|---|---|
| `id` | Lowercase letters, digits and dashes, once in the list. bb also refuses an id of one character and the ids `automatic` and `off`; the other Endpoints are still offered, and `bb plugin logs openai-inference` names the one refused |
| `url` | An `http://` or `https://` URL ending where `/chat/completions` starts, or text holding `${NAME}` references, whole (`${GATEWAY_URL}`) or embedded (`https://${GATEWAY_HOST}/v1`). A trailing `/` is ignored |
| `model` | Required: the name the server lists at `GET <url>/models`, sent as the request's `model`. Saving the list without one is refused with a message that `"model" is required` |
| `key` | Only a `${NAME}` reference. A literal key goes in `keys`, which the settings page keeps secret; the page refuses a literal key here and says so |

The key sent to an Endpoint, as `Authorization: Bearer <key>`, is its entry in `keys`, else its `key` reference, else none.

A saved change applies at once, without a reload: Endpoints added are registered, Endpoints removed are unregistered, and the next request uses the new url, model and key.

## Environment variables

A `${NAME}` is expanded by the plugin's host entry, in bb's daemon on the primary machine, from that daemon's environment, for each request. `localhost` in a `url` means that machine. The expanded value is not stored or logged: the plugin's files and bb's service list hold the reference, and failure messages carry the `${NAME}` in its place.

| Where the variable is set | Reaches the Endpoint | When a change applies |
|---|---|---|
| The environment bb was started with | Yes | When bb restarts |
| `bb machine env set NAME`, or Settings → Environment variables, global scope | Yes | After `bb plugin reload openai-inference`. Saving the plugin's settings again is not enough: the host entry may keep its previous environment |
| `bb machine env set NAME --project <id>`, or a project's scope | No | bb passes project variables to agent turns and commands only |

## Failures

A request that fails rejects with a message that names the Endpoint by its id; bb reports it for the AI task. bb closes the request to the server when it gives up on it, which it does after 5 seconds for a thread title or a commit message.

| Message | When |
|---|---|
| `Endpoint "<id>" answered HTTP <status>: <detail>` | The server answered with a non-2xx status. `<detail>` is the server's own error message, cut to about 300 characters: 401 or 403 for a missing, wrong or expired key, 404 for a wrong URL, 400 for an unknown model, 429 for a rate limit, 422 for a LiteLLM budget that is spent |
| `Could not reach Endpoint "<id>": <reason>` | The connection failed |
| `Endpoint "<id>" answered with something that is not JSON.` | The answer is not a chat completion |
| `Endpoint "<id>" answered without message content.` | The completion has no message content, or it is empty |
| `Endpoint "<id>" broke off its answer: <reason>` | The connection closed before the answer was complete |
| `bb cancelled the request to Endpoint "<id>".` | bb aborted the request, for one that took longer than it allows |
| `Endpoint "<id>" cannot answer: <reason>` | The Endpoint stopped being ready between bb's status read and the request, for the [reasons above](#endpoints) |

No message holds a key or an expanded `${NAME}` value. A key, a variable's value and the host of one that is a URL are replaced by their `${NAME}`, and a literal key by `<key>`.

A 400 or 422 is first taken as the server refusing an optional field, and the request is sent again without it; the message is for the answer to the last request. [Fields a server refuses](../explanation/openai-inference-requests.md#fields-a-server-refuses) says which fields.

## What stays after uninstalling

`bb plugin uninstall openai-inference` deletes the settings. It leaves the host entry's file in `plugins/openai-inference/host-data/`, in the data directory of bb on the primary machine (`~/.bb` by default), readable only by bb's user:

| File | Holds |
|---|---|
| `learned-fields.json` | The [fields each Endpoint URL and model refused](../explanation/openai-inference-requests.md#why-what-was-dropped-is-kept-in-a-file). No keys: URLs as the settings write them, model names and field names |

Delete that folder after uninstalling.
