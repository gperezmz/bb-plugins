---
name: openai-inference
description: Points bb's helper inference (thread titles, commit messages) at a LiteLLM gateway or a local OpenAI-compatible server through the OpenAI-compatible inference plugin. Use when threads get no title, when asked to change BB_INFERENCE, or to set the plugin's gateway or local-server settings.
---

# OpenAI-compatible inference

The plugin adds two services to `bb settings ai-services`:

- `gateway`: a LiteLLM gateway. Its URL and key come from `GATEWAY_URL` and
  `GATEWAY_VIRTUAL_KEY` in bb's environment unless the settings set them.
- `local`: a local OpenAI-compatible server. It needs the `localUrl`
  setting; `localKey` is optional.

Select one with `bb-app config set BB_INFERENCE <service>/<model>`, for
example `gateway/gpt-6-luna`. The model is the name the server knows, and it
cannot contain `/`. `bb settings ai-services` shows the current value.

Settings, with `bb plugin config openai-inference set <key> <value>`:
`gatewayUrl`, `gatewayKey` (secret), `localUrl`, `localKey` (secret). A base
URL ends before `/chat/completions`, e.g. `https://gateway.example.com/v1`.

When titles still do not appear, read `bb plugin logs openai-inference` and
the bb server log for the failure's code: `auth_required` (bad or missing
key), `request_failed` (wrong URL or model, or a missing setting),
`service_unavailable`, `rate_limited`, `timeout` (bb allows 5 seconds for a
title) or `invalid_response`. bb uses `BB_INFERENCE_FALLBACK` only after
`timeout`, `rate_limited` or `service_unavailable`.
