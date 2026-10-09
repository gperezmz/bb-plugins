---
name: openai-inference
description: Configures the Endpoints (LiteLLM gateway, local OpenAI-compatible server) behind bb's thread-title and commit-message AI tasks. Use when an Endpoint's titles fail, or to change a task's service.
---

# OpenAI-compatible inference

Each Endpoint in the plugin's `endpoints` setting is an AI service offered for
the `thread-title` and `commit-message` tasks, and does nothing until it is
selected for one: `bb settings ai-services set <task> <id>`. Automatic never
picks an Endpoint, and bb has no fallback from one selected service to
another: when the selected Endpoint is not ready or its request fails, the
task is not done. `bb settings ai-services` says why a service is not ready,
and `bb settings ai-services test <task>` runs a sample through the selected
one.

Set the plugin's settings with `bb plugin config openai-inference set <key> '<value>'`,
in single quotes so the shell leaves `${...}` alone:

- `endpoints`: JSON list of `{"id", "url", "model", "key"}`, for example
  `[{"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}", "model": "gpt-6-luna"}]`.
  An id is lowercase letters, digits and dashes. A url ends before
  `/chat/completions`. `model` is required and is the name the server lists at
  `GET <url>/models`, and may contain `/`. To use two models on one server,
  list it twice under two ids. url and key may reference bb's environment as
  `${NAME}`; key takes nothing else. A change applies on save.
- `keys` (secret): JSON object from id to a literal key. Ask the user to paste
  keys in the settings page, never on a command line.

A reference is expanded from the environment of bb's daemon on the primary
machine, and `localhost` in a url means that machine. A global
`bb machine env set NAME` reaches the daemon after
`bb plugin reload openai-inference`; a `--project` variable never does.

A failed request names the Endpoint and, for an HTTP error, the status and the
server's own message: a 401 or 403 is a bad or missing key, a 400 or 404 a
wrong model or URL. bb gives a title or a commit message 5 seconds and then
cancels the request, so a model that thinks at length fails that way.
