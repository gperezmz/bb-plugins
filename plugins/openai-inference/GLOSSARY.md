# OpenAI-compatible inference

The plugin that gives bb AI tasks over OpenAI Chat Completions, for a LiteLLM gateway or a local server.

## Language

**Endpoint**:
One OpenAI-compatible server and the model it answers with, which bb offers as one AI service. The plugin keeps the Endpoints in its own storage and edits them on its page in Settings, one card each, or with its command.
_Avoid_: Server, backend, provider, entry of a setting

**Key**:
What an Endpoint sends as its Bearer token: none, a **variable** (a named reference to bb's environment) or a **literal** key typed into the Endpoint's card. A literal key is kept by the host entry on the primary machine, never shown again and deleted with the Endpoint or when it is replaced, cleared or its URL changes.
_Avoid_: Secret, token, password

**AI task**:
A helper job bb hands to an AI service: a thread title, a commit message or a voice transcript.
_Avoid_: Helper completion, helper inference
