# Cache Keeper drive harness

A throwaway bb with Cache Keeper installed from this checkout, real Claude Code threads that talk to a fake Anthropic API, and drives that move the plugin's clock forward, so behaviour that waits minutes or hours in real use is reached and checked in seconds.

The harness never touches your own bb and hands its run none of your credentials. Every process of the run starts from an empty environment holding the **passed list**, the variables named with why in [`run-env.sh`](run-env.sh) (shared by every drive harness in this repository), and what the harness sets: the throwaway's address, a data directory under `/tmp`, its own ports, and a `HOME` of its own, so Claude Code in it reads none of your configuration and spends no tokens. Every bash in the run, the one Claude Code runs its commands in included, skips the system bashrc (`NOSYSBASHRC=1`), which on NixOS sources the machine's profile, so nothing that profile exports enters the run either. A variable your machine's runs need goes on that list; a `start.sh` that fails says where it is.

## Requirements

- Linux (the scripts read `/proc`) and bash.
- `node`, `jq`, `curl`, `git` and `rsync`.
- bb-app's `bb`, `bb-server` and `bb-host-daemon` on your `PATH`, bb 0.46 or later, with its Claude Code provider.
- The plugin's dependencies installed: `npm install` in `plugins/cache-keeper`.

## Start

```sh
plugins/cache-keeper/harness/start.sh
```

It refuses to start, and changes nothing, when any of its ports answers, when its run directory exists, or when a process of an earlier start still runs. Otherwise it starts, in about 15 seconds:

- the fake Anthropic API, `fake-anthropic.mjs`;
- a bb server and a host daemon on a data directory in the run directory, both with `CACHE_KEEPER_DRIVE_CLOCK=1`, and the daemon's Claude Code pointed at the fake API (`ANTHROPIC_BASE_URL`, a fake `ANTHROPIC_API_KEY`);
- a project for the drives' threads, in a git checkout in the run directory;
- Cache Keeper, installed with `bb plugin install path:` from a copy of `plugins/cache-keeper` as the checkout has it, without `dist/`, `node_modules/` and `harness/`. bb builds the copy, so nothing is written into the checkout. "Fetch current prices daily" is switched off, so the plugin uses its bundled prices.

Before it reports the run up, `start.sh` reads every process the run holds for a **leak**, a variable you held when you ran it, same name and value, outside the passed list and the names `run-env.sh` lists as set by the run, or one it planted under a random name; on one it exits non-zero, naming the variable, the process and where the list is kept, never a value. It fails too when `gh auth token` run inside the run finds a GitHub token, which bb would hand every thread it starts; no run process reaches your D-Bus session bus, where a keyring could give one. It keeps what it needs for the leak check in `caller-env` in the run directory: each variable's name and a salted hash of its value.

It prints what to source to point `bb` at the throwaway, and only at it. A shell that sources it stops exporting every variable not on the passed list, so what it sends the run carries the list and the run's own variables alone:

```sh
source /tmp/ck-harness/env.sh
bb cache-keeper status
```

The run directory and ports can be changed, to run two at once or to avoid a port in use:

| Variable | Default | What |
| --- | --- | --- |
| `CK_HARNESS_DIR` | `/tmp/ck-harness` | run directory: bb's data, `HOME`, logs, the plugin's copy |
| `CK_HARNESS_API_PORT` | `40180` | the fake Anthropic API |
| `CK_HARNESS_SERVER_PORT` | `40186` | the bb server |
| `CK_HARNESS_DAEMON_PORT` | `40187` | the host daemon |

Set the same ones for `stop.sh` and the drives.

## The drive clock

With `CACHE_KEEPER_DRIVE_CLOCK=1` in its environment, and only then, the plugin registers two hidden commands:

```sh
bb cache-keeper drive advance 4m   # moves the plugin's clock forward; also 90s, 250ms, 1h
bb cache-keeper drive now          # the clock, as JSON, once the plugin has handled every event so far
```

The clock covers everything the plugin times: the server, its timer, deadlines, idle stretches, no-output waits, and the host entry's reading of transcript and output-file times, which the server passes it the clock's moves for. It only moves forward. Without the variable the clock is wall time, and there is no command to move it. The clock starts again from wall time when the plugin reloads, a reinstall included.

## The drives

Each drive makes its own Claude Code threads with `bb thread spawn` and `bb thread tell`, moves the clock with `bb cache-keeper drive advance`, and checks the result from bb's own records: the thread's event history (`/api/v1/threads/<id>/events`), `bb cache-keeper status --json`, `bb thread output` and the plugin's RPC. It sets the settings it relies on, archives its threads when it ends, prints each check, and ends with `PASS <drive> <seconds>s` or `FAIL`. It fails when it takes 2 minutes or more of wall time.

| Drive | What it reaches and checks |
| --- | --- |
| `compaction.sh` | A thread above its compaction line, switched on: no `/compact` 30 s before its deadline, one within 2 s of it. |
| `tree-keep-warm.sh` | A tree top waiting on a child that waits on a background command, kept warm: the child gets a keep-warm at its deadline and none before, replies with the nothing-new reply, and its report refreshes the top, which gets no keep-warm of its own. |
| `cost-stop.sh` | An 800k-token thread, kept warm, whose keep-warm turns each write 30% of its context: after a few keep-warms none is planned, the next deadline's is held back with "cost stop" in `status` and the log, and none goes after it. |
| `check-in.sh` | "Check on stalled tasks" on, 10-minute wait: no check-in at 9.5 minutes of silence, one at 10, naming the task and saying a task quiet on purpose is fine to leave running, answered with the nothing-new reply; the next one 20 minutes after the first. |
| `skip-undo.sh` | Skip and Undo as the banner and the chip's popover press them: a skipped compaction is held with "skipped" and the Skip ends when the thread runs again; skipped and undone, it is sent. The same for a keep-warm. |
| `reinstall.sh` | With every switch on and Skips pressed, the plugin is uninstalled and installed again: every switch is off, the four settings are back at their defaults, and the first line of `status` says so until a switch is flipped. |
| `archived-quiet.sh` | After the others: no thread they archived got a Cache Keeper message afterwards. |

Run one, or all of them in turn, against a running harness:

```sh
plugins/cache-keeper/harness/drives/compaction.sh
plugins/cache-keeper/harness/drives/run-all.sh
```

`run-all.sh` runs the reinstall last, since it switches everything off and restarts the plugin's clock, and prints a summary. Each drive takes 10 to 35 seconds.

## The fake Anthropic API

`fake-anthropic.mjs` answers `POST /v1/messages`, streamed as Claude Code asks, with a short reply and usage that has cache fields: a context of `context` tokens, `write` of them written to the 5-minute or 1-hour cache and the rest read from it. The last user text steers the reply:

- a message that says `Reply with exactly "X"`, as keep-warms and check-ins do, gets `X`;
- `[fake: background]` gets a Bash `sleep 1800` run in the background, so the thread waits on a task that prints nothing;
- `[fake: fail]` gets an HTTP 400, so the turn ends in error;
- `[fake: hold=N]` gets its answer N seconds late, so the turn stays working that long;
- `/compact`, or a request for a summary, gets a short summary;
- anything else gets `OK`.

Its settings apply to every thread; a marker `[fake: key=value]` anywhere in a thread's conversation overrides one for that thread alone:

| Setting | Default | What |
| --- | --- | --- |
| `context` | 800000 | tokens every turn reports |
| `lifetime` | `5m` | `5m` or `1h`: the cache turns write to |
| `write` | 2000 | tokens an ordinary turn writes to the cache |
| `warmWrite` | 0 | fraction of the context a keep-warm or check-in turn writes instead of reading, as if its cache had gone cold; the higher, the sooner the cost stop |

`GET /_control` shows the settings and `POST /_control` with a JSON object changes them. `GET /_requests` lists the last 200 requests, which are also appended to `requests.jsonl` in the run directory.

## Stop

```sh
plugins/cache-keeper/harness/stop.sh          # stops everything and removes the run directory
plugins/cache-keeper/harness/stop.sh --keep   # keeps it, logs and bb's data included
```

It finds every process the harness started by a mark in its environment (`CK_HARNESS=<run directory>`) or the throwaway bb's data directory, so it finds the bb server's detached child, Claude Code, and the background commands the drives started too. It prints each one's command line before stopping it, kills any still running after 10 seconds, then checks again that none carries the mark and that none of its ports answers. It removes the run directory only when both hold, and exits non-zero otherwise.

To find a run's processes yourself, test each one's environment for the mark, as `stop.sh` does, with `grep -qzxE "CK_HARNESS=<run directory>" /proc/<pid>/environ`, whose answer is the exit status alone. Never print a process's environment, the run's or anyone's: your own processes hold your credentials.

## Guarantees

- **Never your bb, none of your credentials.** Every process of the run holds the passed list and what the harness sets, nothing else of yours, a data directory in the run directory, `HOME` in the run directory, and ports other than bb's usual ones and the npm-install check's 39886/39887.
- **Refuses busy ports and directories.** `start.sh` starts nothing when a port answers, the run directory exists, or a process of an earlier start runs.
- **Stop leaves nothing.** `stop.sh` exits 0 only when no process carries the harness's mark and no harness port answers.

## Files

- `start.sh`, `stop.sh`, `config.sh`: the throwaway bb; `config.sh` holds the ports, the run directory and the process search both use.
- `run-env.sh`: the passed list, and the leak check, for this harness, Unattendish's and the driving-bb-plugins skill's.
- `run-env.test.sh`: checks `run-env.sh` (the leak check, what a run's environment holds, `env.sh`'s un-exporting and the start-time check) against processes it starts itself, with no bb, and fails when the passed list, the names listed as set by the run or what `run-env.sh` adds to a run's environment holds a **refused name**, a credential or a variable pointing at one; a variable a machine needs stays a one-file edit to `run-env.sh` unless its name is refused, which the failure says. CI runs it on every pull request; run it yourself after changing `run-env.sh`, before you push.
- `fake-anthropic.mjs`: the fake Anthropic API.
- `drives/lib.sh`: what every drive shares. `drives/*.sh`: the drives, and `run-all.sh`.
- In the run directory: `env.sh`, `caller-env`, `server.log`, `host-daemon.log`, `fake-anthropic.log`, `requests.jsonl`, `drive-threads` (every drive's threads), and bb's data under `bb/` (its own logs in `bb/logs/`).
