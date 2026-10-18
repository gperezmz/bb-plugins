---
name: openai-inference
description: Configures the Endpoints (LiteLLM gateway, local OpenAI-compatible server) for bb's title and commit-message AI tasks. Use when such a server gives no titles, or to change a task's service.
---

# OpenAI-compatible inference

Each Endpoint of the plugin is an AI service offered for the `thread-title` and
`commit-message` tasks, and does nothing until it is selected for one:
`bb settings ai-services set <task> <id>`. Automatic never picks an Endpoint,
and bb has no fallback from one selected service to another: when the selected
Endpoint is not ready or its request fails, the task is not done.
`bb settings ai-services` says why a service is not ready, and
`bb settings ai-services test <task>` runs a sample through the selected one.

List, add, change and remove Endpoints with `bb openai-inference`, giving
`--url` and `--key` in single quotes so the shell leaves `${...}` alone:

- `bb openai-inference list`: each Endpoint's id, URL, model and key kind
  (`none`, `variable NAME`, `literal (set)` or `literal (not set)`), never a
  literal key.
- `bb openai-inference set <id> --url <url> --model <model> [--key '${NAME}']`:
  adds the Endpoint, or replaces the URL and model of the one with this id.
  An id is lowercase letters, digits and dashes, and is fixed once saved. A url
  ends before `/chat/completions`. `--model` is the name the server lists at
  `GET <url>/models`, and may contain `/`. To use two models on one server, add
  it twice under two ids. url and key may reference bb's environment as
  `${NAME}`; `--key` takes nothing else, so it never takes a literal key, and
  it changes the key only when given. A change applies at once.
- `bb openai-inference remove <id>`: removes the Endpoint, and a task selecting
  it stops until another service is selected.

A literal key is typed into the Endpoint's card under Settings → Installed
plugins → OpenAI-compatible inference, in the **Endpoints** section: ask the
user to type it there, never on a command line. The plugin keeps it in a file
only bb's user reads on the primary machine, never shows it, and deletes it
when the Endpoint is removed, the key is replaced, the Endpoint is saved with
None or a variable, or the Endpoint's URL changes. A changed URL leaves the
card Literal and not set, which the Endpoint's status names until the user types
the key again, so `set` refuses a new URL for an Endpoint with a literal key.

A reference is expanded from the environment of bb's daemon on the primary
machine, and `localhost` in a url means that machine. A global
`bb machine env set NAME` reaches the daemon after
`bb plugin reload openai-inference`; a `--project` variable never does.

A failed request names the Endpoint and, for an HTTP error, the status and the
server's own message: a 401 or 403 is a bad or missing key, a 400 or 404 a
wrong model or URL. bb gives a title or a commit message 5 seconds and then
cancels the request, so a model that thinks at length fails that way.
