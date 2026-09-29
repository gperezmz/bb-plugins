---
name: driving-bb-plugins
description: Drives this repository's bb plugins (Thread Glance, Thread Usage, UI Tweaks, Pocket Navigation, Cache Keeper) for real, in a throwaway bb, through its web UI in headless Chromium and the bb CLI. Use when a plugin change has to be seen working in bb, when asked to run, click through, screenshot or try a plugin, or to check what a plugin shows or stores after a user action.
---

# Driving bb-plugins

Every plugin in `plugins/` is driven the same way: a throwaway bb server and
host daemon on a data directory of their own, the plugins under test
installed from a copy of this checkout, and the drive done through bb's web
UI and bb's CLI. The **feature map** in [`features/README.md`](features/README.md)
says what each plugin shows and how to reach it; read it, then the file for
the feature you are driving, before the first drive.

The harness is `drive-bb-plugins` beside this file. Every path below is from
the repository root.

## Launch

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins start <plugin>...
```

`<plugin>` is a directory name under `plugins/`: the one under test, plus any
the feature file's preconditions name. Ready is the command exiting 0 after
printing `run`, `web UI`, `project` and `evidence`, in about 10 seconds, or
a minute more in a checkout without `plugins/thread-glance/node_modules`,
which it installs for Playwright. It needs `node`, `npm`, `jq`, `curl`,
`git`, `rsync`, `bb`, `bb-server` and `bb-host-daemon` on `PATH`, and bb
builds each plugin's copy itself, so the checkout gains no `dist/`.

The `run` line is the run's name. Every later command names it with
`--run <run>` straight after the command, as every command below does.
Without it a command acts on `$DBP_RUN`, else on the run this checkout
started last, which is another agent's run wherever two share a checkout.

What a run holds:

- a bb server at the `web UI` address, a host daemon enrolled as the machine,
  and a project named `drives` in a git repository of its own;
- Claude Code threads answered by Cache Keeper's fake Anthropic API
  (`plugins/cache-keeper/harness/README.md#the-fake-anthropic-api` says how a
  prompt steers it), so a thread spends no tokens;
- `CACHE_KEEPER_DRIVE_CLOCK=1`, so `bb cache-keeper drive advance` exists.

A run never touches the user's bb: every command the harness runs has the
variables naming a bb unset or pointed at the run, and `HOME` inside the
run's scratch directory. Reach the run only through the harness's commands,
since a bare `bb` in this shell talks to the user's own bb.

Any number of runs go side by side, from one checkout or several: each
`start` takes three free ports of its own and a scratch directory of its
own, and `stop` touches only its own run. `DBP_SERVER_PORT`,
`DBP_DAEMON_PORT` and `DBP_API_PORT` choose the ports instead, where
something has to reach a run on a known one.

Teardown is [Cleanup](#cleanup).

## Doctor

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins doctor --run <run>
```

Exits 0 only when the run points away from the user's bb, its fake API, bb
server and host daemon are alive, the server on the run's port serves the
run's own data directory, the machine is connected, and every plugin started
runs from the run's copy. Run it before the first drive, after any drive that
failed or surprised you, and whenever a command answers from a bb you did
not expect. A run that fails it is stopped and started again, not driven.

## Drive

CLI actions, each logged as evidence under a label naming the feature and the
entry point (`ui-tweaks.text-size/rpc`):

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins bb --run <run> <label> -- <bb arguments>
```

The arguments are `bb`'s own: `plugin rpc call <plugin> <method> --input-file
<json file> --json`, `settings ui get|set <key>`, `plugin config <plugin> set
<key> <value>`, and each plugin's command (`thread-glance prefs`,
`thread-usage show`, `cache-keeper status`). A JSON input goes in a file,
passed with `--input-file`.

Threads, for a feature that needs one, in the run's project, printing the id
once the first turn has ended:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins spawn --run <run> <label> <title> <prompt> [<parent-thread>]
```

UI actions, run as a Playwright script against the run's web UI:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins ui --run <run> <label> <steps.mjs> [--mobile]
```

`<steps.mjs>` default-exports `async ({ page, url, capture }) => {}`. The page
has already loaded `url`, the web UI's root, and `process.env.DBP_HARNESS`
is this harness's path and `process.env.DBP_RUN` the run, for a CLI action
between two captures; `--mobile` makes it a 390×844
touch phone, the default is a 1440×900 desktop. `capture(name, action)` saves
the page's state after `action`. A thrown error fails the command and
captures `failure`. It uses `plugins/thread-glance`'s Playwright and
launches `CHROMIUM_PATH` or the `chromium` on `PATH`.

Illustrative, for the shape only:

```js
export default async ({ page, url, capture }) => {
  await page.goto(url + "settings/plugins/ui-tweaks");
  const group = page.getByRole("radiogroup", { name: "Text size" });
  await capture("before", "open Settings → UI Tweaks");
  await group.getByRole("radio", { name: "Large" }).click();
  await group.getByRole("radio", { name: "Large", checked: true }).waitFor();
  await capture("after", "click Large");
};
```

The script has Playwright's library and no test runner, so a check is a
`waitFor` on the state the action should reach, or a thrown `Error`.

Locate by the roles and accessible names the plugin gives its elements, as
the feature file lists them; no plugin sets `data-testid`. bb's own routes
are plain paths under the root: `settings`, `settings/appearance`,
`settings/plugins/<plugin>` for a plugin's settings section.

## Evidence

Every drive reads back two things: what the user saw after the action, and
what bb stored because of it.

- **The action beside the state**: a `capture` before and after each UI
  action, each an ARIA snapshot and a screenshot, with the action written
  beside them in `actions.md`.
- **The stored effect**: after a UI action, read the same state back through
  the CLI or the plugin's RPC with `drive-bb-plugins bb`, as the feature file
  names it. After a CLI action, capture the UI it should change, with no
  reload where the feature says it updates live.
- **What no screen shows**: `console.log` beside the captures holds the
  page's errors, and `stop` saves each plugin's own log (`bb plugin logs`) as
  `plugin-<id>.log`. A warning or error there from the drive is a finding.

The only thing mocked is the Anthropic API behind Claude Code, which bb
already reaches over HTTP. Everything the plugin does in bb is real: the
server, the host daemon, the build, the settings store. A drive reached one
way is reported as that way only: a setting written through the CLI does not
verify the settings screen that writes it.

## Evidence location

`.drives/<run id>/` at the repository root, ignored by git:

- `cli.md`: every `bb` and `spawn` command with its stdout, stderr and exit;
- `ui/<label>/`: `NN-<name>.aria.yml`, `NN-<name>.png`, `actions.md`,
  `console.log` and the `steps.mjs` that made them;
- after `stop`: `plugin-<id>.log`, `server.log`, `host-daemon.log`,
  `fake-anthropic.log` and `requests.jsonl`;
- `pids`, `launch-pids`, `run.env` and `env.sh`: the handles `stop` kills by
  and the run's settings, its ports included.

## Cleanup

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins stop --run <run>
```

Run it after the last drive, and after every failed attempt before the next
`start`. It saves the logs into the evidence, kills each PID recorded in
`.drives/<run>/pids` that still carries the run's mark in its environment,
releases the run's ports, removes the scratch directory, and keeps
`.drives/<run>/`. Other runs, from this checkout or another, are left
running. It exits 0 only
when no process carrying the mark is left; otherwise it prints them and
keeps the scratch.

Done when it exits 0, and this exits non-zero:

```bash
ps -p "$(paste -sd, - < .drives/<run>/pids)"
```

## Helpers

- `.agents/skills/driving-bb-plugins/drive-bb-plugins start|doctor|bb|spawn|ui|stop`:
  the harness above. Run with no arguments, it prints its usage.
- `.agents/skills/driving-bb-plugins/browser.mjs`: what `ui` runs; not called
  directly.
- `plugins/cache-keeper/harness/`: Cache Keeper's own drives, on a separate
  throwaway bb with ports 40180 to 40187. Its README says when to reach for
  them.
