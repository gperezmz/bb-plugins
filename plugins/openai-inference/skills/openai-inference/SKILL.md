---
name: openai-inference
description: Points bb's helper inference (thread titles, commit messages) at a LiteLLM gateway or a local OpenAI-compatible server through the OpenAI-compatible inference plugin. Use when threads get no title, when asked to change BB_INFERENCE or BB_INFERENCE_FALLBACK, or to add or change the plugin's endpoints.
---

# OpenAI-compatible inference

Each endpoint in the plugin's settings is an AI service in
`bb settings ai-services`. Select one with
`bb-app config set BB_INFERENCE <id>/<model>`, and another with
`bb-app config set BB_INFERENCE_FALLBACK <id>/<model>`, for example
`mlx/qwen3.5-2b` and `gateway/gpt-6-luna`. The model is the name the server
lists at `GET <url>/models`, and it cannot contain `/`.

Settings, with `bb plugin config openai-inference set <key> '<value>'`
(single quotes, so the shell leaves `${...}` alone):

- `endpoints`: JSON list of `{"id", "url", "key"}`, e.g.
  `[{"id": "mlx", "url": "http://127.0.0.1:8080/v1"}, {"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}"}]`.
  An id is lowercase letters, digits and dashes; a url ends before
  `/chat/completions`. url and key may reference bb's environment as
  `${NAME}`; key takes nothing else.
- `keys` (secret): JSON object from id to a literal key, e.g.
  `{"mlx": "sk-..."}`. Ask the user to paste keys in the settings page, never
  on a command line.

A reference is expanded from the environment of bb's daemon on the server
machine. A global `bb machine env set NAME` (or Settings → Environment
variables) reaches it after `bb plugin reload openai-inference`; a
`--project` variable never does. An endpoint whose variables are unset is
not registered, and `bb plugin logs openai-inference` names them.

When titles still do not appear, read the bb server log
(`~/.bb/logs/server.1.log`) for `errorCode`: `ai_service_auth_required`
(bad or missing key), `ai_service_request_failed` (wrong URL or model, an
unknown endpoint id, or an unset variable), `ai_service_unavailable`,
`ai_service_rate_limited`, `ai_service_invalid_response`, or an inference
timeout (bb allows 5 seconds for a title). bb uses `BB_INFERENCE_FALLBACK`
only after a timeout, a rate limit or an unavailable service.
