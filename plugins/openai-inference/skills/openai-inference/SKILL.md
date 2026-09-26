---
name: openai-inference
description: Points bb's AI tasks (thread titles, commit messages) at a LiteLLM gateway or a local OpenAI-compatible server through the OpenAI-compatible inference plugin. Use when threads get no title, when asked to select or change the service for an AI task, or to add or change the plugin's Endpoints.
---

# OpenAI-compatible inference

Each Endpoint in the plugin's `endpoints` setting is an AI service in
`bb settings ai-services`, offered for the `thread-title` and
`commit-message` AI tasks. It does nothing until it is selected for a task:

```sh
bb settings ai-services set thread-title <id>
bb settings ai-services set commit-message <id>
```

Automatic never picks an Endpoint, and bb has no fallback from one selected
service to another: when the selected Endpoint is not ready or its request
fails, the task is not done. `bb settings ai-services` lists each service
and, for one that is not ready, why; `bb settings ai-services test
<thread-title|commit-message>` runs a sample through the selected one.

Settings, with `bb plugin config openai-inference set <key> '<value>'`
(single quotes, so the shell leaves `${...}` alone):

- `endpoints`: JSON list of `{"id", "url", "model", "key"}`, e.g.
  `[{"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "qwen3-4b"}, {"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}", "model": "gpt-6-luna"}]`.
  An id is lowercase letters, digits and dashes; a url ends before
  `/chat/completions`; `model` is required and is the name the server lists
  at `GET <url>/models`, and may contain `/`. To use two models on one
  server, list it twice under two ids. url and key may reference bb's
  environment as `${NAME}`; key takes nothing else. A change applies on save.
- `keys` (secret): JSON object from id to a literal key, e.g.
  `{"mlx": "sk-..."}`. Ask the user to paste keys in the settings page, never
  on a command line.

A reference is expanded from the environment of bb's daemon on the primary
machine, and `localhost` in a url means that machine. A global `bb machine env set NAME` (or
Settings → Environment variables) reaches it after
`bb plugin reload openai-inference`; a `--project` variable never does. An
Endpoint that has no `model`, or whose variables are unset, is listed as not
ready and names the reason.

When titles still do not appear, `bb settings ai-services` says whether the
selected Endpoint is ready and, if not, why, and `bb settings ai-services
test thread-title` reports the failure of a request. A failure names the
Endpoint and, for an HTTP error, the status and the server's own message:
a 401 or 403 is a bad or missing key, a 400 or 404 a wrong model or URL. bb
gives a title or a commit message 5 seconds and then cancels the request, so
a model that thinks at length fails that way.
