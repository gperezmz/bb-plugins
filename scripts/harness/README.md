# Shared drive harness helpers

The Unattendish drive harness and the driving-bb-plugins skill use these helpers to run Claude Code against a fake API and keep the caller's credentials out of a throwaway bb. Neither helper depends on a plugin being installed.

## Environment isolation

`run-env.sh` holds the passed list: each variable a run takes from its caller, with why. Harnesses source it, start processes with `env -i "${run_env[@]}"` plus their own run variables, and check those processes for leaks. Its header and function comments describe the record, leak check and generated environment script.

`run-env.test.sh` starts its own processes, without bb, and checks the passed list, refused names, leak detection, generated environment script and git default branch:

```sh
scripts/harness/run-env.test.sh
```

## The fake Anthropic API

`fake-anthropic.mjs` answers `POST /v1/messages`, streamed when requested, with a short reply and usage containing cache fields. The last user text steers the reply:

- `Reply with exactly "X"` gets `X`.
- `[fake: background]` gets a Bash `sleep 1800` run in the background.
- `[fake: fail]` gets HTTP 400, so the turn ends in error.
- `[fake: ask]` gets an AskUserQuestion, so the turn waits on a question until it is answered (`bb thread interactions answer`).
- `[fake: approve]` gets a Bash `touch fake-approval.txt`, which waits on an approval in a turn not run in full permission mode (`bb thread tell --permission-mode accept-edits`).
- `[fake: hold=N]` delays its answer by N seconds.
- `/compact`, or a request for a summary, gets a short summary.
- Anything else, including a tool result, gets `OK`.

The source header lists the usage settings and their environment variables. A marker `[fake: key=value]` anywhere in a conversation overrides a setting for that conversation. `GET /_control` reads the shared settings; `POST /_control` changes them. `GET /_requests` lists the last 200 requests; setting `REQUEST_LOG` also appends them to that file. Harnesses set `PORT` for their own run.

The [Unattendish harness](../../plugins/unattendish-sdlc/harness/README.md) and the [driving skill](../../.agents/skills/driving-bb-plugins/SKILL.md) own startup, teardown and evidence collection.
