---
name: driving-bb-plugins
description: Drives this repository's bb plugins (Thread Glance, Thread Usage, UI Tweaks, Cache Keeper, Unattendish) for real, in a throwaway bb, through its web UI in headless Chromium and the bb CLI. Use when a plugin change has to be seen working in bb, when asked to run, click through, screenshot or try a plugin, or to check what a plugin shows or stores after a user action.
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
.agents/skills/driving-bb-plugins/drive-bb-plugins start [--snapshot <name>] <plugin>...
```

`<plugin>` is a directory name under `plugins/`: the one under test, plus any
the feature file's preconditions name. `--snapshot` starts the run on a copy
of a saved bb, threads and all ([Snapshots](#snapshots)). Ready is the command exiting 0 after
printing `run`, `web UI`, `project` and `evidence`, in about 10 seconds, or
a minute more in a fresh checkout, where it runs `npm ci` in
`plugins/thread-glance` for Playwright and in each plugin started that has
no `node_modules`. It needs `node`, `npm`, `jq`, `curl`,
`git`, `rsync`, `flock`, `systemd-run`, `bb`, `bb-server` and `bb-host-daemon`
on `PATH`, and bb builds each plugin's copy itself, so the checkout gains no
`dist/`.

A run shares the machine with the user's own bb and editor, so it is
**memory-capped**. `start` refuses while less than `DBP_MIN_FREE` (default
`4G`) of memory is available once other runs have grown to their caps, and
starts the run's fake API, bb server and host daemon in a systemd user scope,
`dbp-<id>.scope`, capped at `DBP_MEMORY_MAX` (default `6G`) with no swap.
Everything they start, Claude Code included, stays in the scope, so a run that
passes its cap loses its own processes, all of them, and nothing else. An idle
run takes about 1.7G and each loaded Claude Code session about 0.4G more. Where
`systemd-run --user --scope` fails, `start` refuses; `DBP_UNCAPPED=1` starts it
uncapped, which is for a machine with no systemd user manager only.

The `run` line is the run's name. Every later command names it with
`--run <run>` straight after the command, as every command below does.
Without it a command acts on `$DBP_RUN`, else on the run this checkout
started last, which is another agent's run wherever two share a checkout.

What a run holds:

- a bb server at the `web UI` address, a host daemon enrolled as the machine,
  and a project named `drives` in a git repository of its own;
- Claude Code threads answered by Cache Keeper's fake Anthropic API
  (`plugins/cache-keeper/harness/README.md#the-fake-anthropic-api` says how a
  prompt steers it), so a thread spends no tokens. Claude Code is the run's
  only provider, so a thread sent from the web UI's compose screen is one of
  these too;
- bb's first-run setup guide marked done, so the web UI opens on the app;
- `CACHE_KEEPER_DRIVE_CLOCK=1`, so `bb cache-keeper drive advance` exists;
- with `unattendish-sdlc` started, a fake GitHub, GitLab, Linear and Jira
  and one Unattendish account on each ([Fake services](#fake-services)).

A run never touches the user's bb and holds none of the caller's
credentials: every process of the run starts from an empty environment
holding the **passed list**, the variables named with why in
`plugins/cache-keeper/harness/run-env.sh`, and what the harness sets for the
run, its mark (`DBP_MARK`), its bb's address, `HOME` inside its scratch
directory and `NOSYSBASHRC=1`, so no bash in the run reads the machine's
profile, among them. A variable this machine's runs need goes on that list;
a `start` that fails says where it is. Reach the run only through the
harness's commands, since a bare `bb` in this shell talks to the user's own
bb; a shell that sources the evidence's `env.sh` stops exporting whatever is
not on the list, so what it sends the run carries the list alone.

Any number of runs go side by side, from one checkout or several: each
`start` takes three free ports of its own (seven with `unattendish-sdlc`)
and a scratch directory of its own, and `stop` touches only its own run. `DBP_SERVER_PORT`,
`DBP_DAEMON_PORT` and `DBP_API_PORT` choose the ports instead, where
something has to reach a run on a known one.

Teardown is [Cleanup](#cleanup).

## Doctor

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins doctor --run <run>
```

Exits 0 only when the run points away from the user's bb, its scope is active
with the cap `start` printed and holds its bb server, its fake API, bb server
and host daemon are alive (and, with `unattendish-sdlc`, its fake services
answer), the server on the run's port serves the
run's own data directory, the machine is connected, and every plugin started
runs from the run's copy, and no process of the run holds a **leak**: a
variable the caller held at `start`, same name and value, outside the passed
list and the names `run-env.sh` lists as set by the run, or the one `start`
planted under a random name. It names each leak's
variable and process, never a value, and where the list is kept. It fails
too when `gh auth token` run inside the run finds a GitHub token, which bb
would hand every thread it starts. Run it before the first drive, after any drive that
failed or surprised you, and whenever a command answers from a bb you did
not expect. A run that fails it is stopped and started again, not driven; a
scope reading `failed/oom-kill` passed its cap, and starts again with fewer
sessions (`DBP_MAX_SESSIONS`) or a larger `DBP_MEMORY_MAX`.

## Drive

CLI actions, each logged as evidence under a label naming the feature and the
entry point (`ui-tweaks.text-size/rpc`):

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins bb --run <run> [--as <thread>] <label> -- <bb arguments>
```

`--as <thread>` runs the command as that thread, with `BB_THREAD_ID` set,
which is how bb tells a plugin command its calling thread: a manager
registering an Unattendish fleet.

The arguments are `bb`'s own:
`plugin rpc call <plugin> <method> --input-file <json file> --json`,
`settings ui get|set <key>`, `plugin config <plugin> set <key> <value>`, and
each plugin's command (`thread-usage show`, `cache-keeper status`), plus bb's
own, such as `terminal create --thread <id>`. A JSON input goes in a file,
passed with `--input-file`.

Threads, for a feature that needs one, in the run's project, printing the id
once the first turn has ended:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins spawn --run <run> <label> <title> <prompt> [<parent-thread>] [--fail|--hold <s>|--background] [--worktree|--beside <thread>]
```

bb keeps a thread's Claude Code loaded after its turn, so `spawn` releases it
with `bb thread stop` before returning; the thread still reads `idle`, and a
later `bb thread tell` loads it again. A flag puts the thread in a state an
ordinary turn never reaches:

- `--fail`: the turn ends in error (bb status `error`, `Failed` in a list).
- `--hold <s>`: `spawn` prints the id while the turn works, and the turn ends
  `<s>` seconds later; its runtime is released then.
- `--background`: the turn leaves a command running in the background, and
  the runtime stays loaded to keep it running, holding its session slot until
  `drive-bb-plugins release --run <run> <thread>` stops both.

A thread works in the project's checkout, or its parent's where it has one;
`--worktree` gives it a git worktree of its own instead, and
`--beside <thread>` puts it in that thread's.

At most `DBP_MAX_SESSIONS` (default 4, fixed at `start`) `spawn`s of a run hold
a session at once, and the rest wait for a slot; bb's own
`concurrency-limit global` is set to the same number. Threads are made by
`spawn` and `seed` only: the `bb` command refuses `thread spawn`. A
`bb thread tell` to many threads goes through a bounded pool such as
`xargs -P <sessions>`, each followed by `bb thread stop` once
`bb thread wait <id> --status idle` returns.

### Seeding

More than a few threads (a list, a sidebar, a performance audit) come from
`seed` and a shape file, never from `spawn` one by one:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins seed --run <run> <shape.json>
```

A shape declares tree groups and a few threads in each state a drive needs;
[`shapes/user-800.json`](shapes/user-800.json) is the user's own bb, 802
threads with 104 live, seeded in about 20 seconds:

```json
{
  "trees": [
    { "count": 139, "children": 4, "archived": true },
    { "count": 10, "children": 2, "section": "Reviews", "title": "review" }
  ],
  "states": { "failed": 2, "finished": 3, "unread": 3 }
}
```

- `trees`: each group is `count` root threads with `children` child threads
  each (default 0), in section `section` when it names one (made if the run
  has none of that name), and archived, children too, when `archived` is
  true. Roots are titled `<title> <n>` (`title` defaults
  to `quiet`, or `archived`), children `<title> <n>.<k>`. These are **quiet
  threads**: made over bb's HTTP API with no turn, they read `pending` in bb
  and draw as a read row finished when it was made, which settles like any
  other; their hover card has no Branch and Model reads `Not set`. A quiet
  thread has never run, so a drive that tells a thread or reads its reply uses
  a `finished` one.
- `states`: how many threads, titled `<state> <n>`, in each state only a turn
  or a fork makes. `finished` and `unread` are forks of one real turn, `Idle`
  read and `Unread`; `failed`, `working` (for `hold` seconds, default 600) and
  `background` each run a real turn, as `spawn`'s flags do. Working and
  background threads each hold a session slot, a working one until its turn
  ends, so together they fit in the slots free when `seed` starts.

Titles number on past the ones the run already has, so a second `seed` adds
threads beside the first's. `seed` prints what it made and writes every id,
by title, to `seed.json` in the evidence. A real-turn child spawned under a
quiet parent leaves the parent `pending`, with no turn and no wake.

### Fake services

A run started with `unattendish-sdlc` also runs
`plugins/unattendish-sdlc/harness/fake-services.ts`: a fake GitHub, GitLab,
Linear and Jira, each on a port `start` prints on its `fakes` line, and one
account on each, added through the plugin's `connect` as its Connect popup
adds one:

| Account | The default for |
| --- | --- |
| `GitHub · operator` | `github.example`, a token for the owner `org` |
| `GitLab · operator` | `gitlab.example` |
| `Linear · operator@example.com` | `linear.app` |
| `Jira · operator@example.com` | `acme.atlassian.net` |

So a fleet on `github.example/org/<repo>`, `gitlab.example/group/<proj>`, or
with tracker `linear:<team>` or `jira:acme.atlassian.net/<project>`, reads as
one of them. A drive scripts a fake, logged in `cli.md`, with:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins fake --run <run> <label> github|gitlab|linear|jira state [<file>]|requests|reset
```

`state <file>` loads the JSON the fake answers from (each fake's shape is in
`plugins/unattendish-sdlc/test/fakes/`), `state` alone reads it, `requests`
prints every request the plugin sent it, and `reset` empties that log. The
fakes keep the times the state gives, so a change dated a few seconds ahead
of now is read by the next poll. `plugins/unattendish-sdlc/harness/README.md`
says what each of its own drives checks, and `harness/drives/lib.sh` builds
the states and manifests they use.

### Snapshots

A seeded bb is saved once per bb version and started from as often as
wanted:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins save --run <run> <name>
.agents/skills/driving-bb-plugins/drive-bb-plugins snapshots
.agents/skills/driving-bb-plugins/drive-bb-plugins start --snapshot <name> [<plugin>...]
```

`save` stops the run, as `stop` does, and keeps its bb data directory, the
project's repository and Claude Code's sessions as snapshot `<name>` of the bb
on `PATH`, in `$DBP_SNAPSHOT_ROOT` (default
`~/.cache/drive-bb-plugins/snapshots`), shared by every checkout; it replaces
a snapshot of that name. It refuses while a thread is working or a
`--background` thread is unreleased, since a saved bb loses both: seed those
on the restored run. It refuses a run started with `unattendish-sdlc`, whose
accounts and fleets name that run's fake-service ports. `start --snapshot` copies the snapshot into the run's own
scratch, points every path it saved at that scratch, reinstalls the plugins
named (or the snapshot's) from this checkout and uninstalls any other it
saved, in about 7 seconds for 802 threads. Any number of runs start from one
snapshot at once; a `save` over it waits until their copies are done. `snapshots` lists the bb version's snapshots.

The machine the run's threads work on goes away and comes back with
`drive-bb-plugins machine --run <run> offline|online`. Offline stops the
host daemon, and every session and command with it; online starts it again
inside the run's scope, and doctor passes again once it is back.

UI actions are **verbs**, one per step a feature file's recipe takes, each
a Playwright drive carrying the plugin's own selectors:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins <plugin> --run <run> <verb> [<args>] [--second-window] [--reload] [--mobile] [--label <label>]
```

The feature file names the verb for each step, and the command with no verb
lists a plugin's verbs; they live in `verbs/<plugin>.mjs` beside this file.
A verb captures before and after its action, reads back what bb stored, and
prints JSON of all of it; `--second-window` adds what a window opened before
the action showed with no reload, `--reload` what this window shows after
one. A UI step no verb covers becomes a new verb, as the map's
[driving conventions](features/README.md#driving-conventions) say;
`browser.mjs`'s header says what a verb is given.

Writing a verb starts from its screen, looked at with a Playwright script:

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins ui --run <run> <label> <steps.mjs> [--mobile]
```

`<steps.mjs>` default-exports `async ({ page, url, capture }) => {}`. The page
has already loaded `url`, the web UI's root, and `process.env.DBP_HARNESS`
is this harness's path and `process.env.DBP_RUN` the run, for a CLI action
between two captures, and a verbs file's helpers import from
`process.env.DBP_SKILL + "/verbs/<plugin>.mjs"`; `--mobile` makes it a 390×844
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
`settings/plugins/<plugin>` for a plugin's settings section, and
`projects/<project>/threads/<thread>` for a thread, its `projectId` in
`bb thread show <thread> --json`.

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

`${TMPDIR:-/tmp}/drives-<uid>/bb-plugins/<run id>/`, the path `start` prints
on its `evidence` line: private to the user, shared by every checkout, and
outside the repository, so it outlives the worktree a drive ran from. The run
a command acts on by default is the one this checkout started last, kept as
`latest-<checkout key>` beside the runs:

- `cli.md`: every `bb` and `spawn` command with its stdout, stderr and exit;
- `ui/<label>/`: `NN-<name>.aria.yml`, `NN-<name>.png`, `actions.md`,
  `console.log` and the `steps.mjs` that made them, or for a verb, in
  `ui/<plugin>.<verb>[-N]/`, the `verb.txt` that made them and its
  `result.json`;
- after `stop`: `plugin-<id>.log`, `server.log`, `host-daemon.log`,
  `fake-anthropic.log`, `requests.jsonl` and, with Unattendish,
  `fake-services.log`;
- `seed.json`: the last `seed`'s threads, by title and id;
- `pids`, `launch-pids`, `run.env` and `env.sh`: the handles `stop` kills by
  and the run's settings, its ports and scope included;
- `slots/`: the locks `spawn` holds its session slots by, and `kept`: each
  `--background` thread with the process holding its slot.

## Cleanup

```bash
.agents/skills/driving-bb-plugins/drive-bb-plugins stop --run <run>
```

Run it after the last drive, and after every failed attempt before the next
`start`, a run its cap ended included. It saves the logs into the evidence,
kills each PID recorded in the evidence's `pids` that still carries the run's
mark in its environment, stops and unloads the run's scope, releases the
run's ports, removes the scratch directory, and keeps
the evidence. Other runs, from this checkout or another, are left
running. It exits 0 only
when no process carrying the mark is left; otherwise it prints them and
keeps the scratch.

A run's processes are the ones whose environment holds its mark, tested as
`stop` does, with `grep -qzxF "DBP_MARK=<scratch>" /proc/<pid>/environ`,
whose answer is the exit status alone (`<scratch>` is `scratch=` in the
evidence's `run.env`). Never print a process's environment,
the run's or anyone's: the caller's own processes hold its credentials.

Done when it exits 0, and this exits non-zero:

```bash
ps -p "$(paste -sd, - < "${TMPDIR:-/tmp}/drives-$(id -u)/bb-plugins/<run>/pids")"
```

## Helpers

- `.agents/skills/driving-bb-plugins/drive-bb-plugins start|doctor|bb|fake|spawn|seed|release|machine|<plugin>|ui|stop|save|snapshots`:
  the harness above. Run with no arguments, it prints its usage.
- `.agents/skills/driving-bb-plugins/seed.mjs`: what `seed` runs for quiet
  threads; not called directly.
- `.agents/skills/driving-bb-plugins/shapes/`: shapes to seed from.
- `.agents/skills/driving-bb-plugins/verbs/<plugin>.mjs`: a plugin's verbs.
- `.agents/skills/driving-bb-plugins/browser.mjs`: what `ui` and the verbs
  run; not called directly.
- `plugins/cache-keeper/harness/`: Cache Keeper's own drives, on a separate
  throwaway bb with ports 40180 to 40187. Its README says when to reach for
  them.
