# Unattendish drive harness

A throwaway bb with Unattendish installed from this checkout, real Claude Code manager threads that talk to a fake Anthropic API, a fake GitHub, GitLab, Linear and Jira Cloud that the plugin polls, and drives that register fleets, script the fakes over HTTP and read what reached the managers, the ledger and the status. Every poll interval is set to the 30-second floor, so a drive waits at most about 35 seconds for a poll.

The harness never touches your own bb. Every command it runs has the variables that name a bb (`BB_SERVER_URL`, `BB_THREAD_ID`, `BB_PROJECT_ID`, `BB_ENVIRONMENT_ID`, `BB_CLI` and the like) unset or pointed at the throwaway, a data directory under `/tmp`, its own ports, and a `HOME` of its own, so Claude Code in it reads none of your configuration and spends no tokens. Nothing it writes goes inside the checkout, and no drive calls a real service: the credentials it installs have loopback base URLs and fake tokens.

## Requirements

- Linux (the scripts read `/proc`) and bash.
- `node` 24 (it runs `fake-services.ts` and reads `bb`'s database with `node:sqlite`), `jq`, `curl`, `git` and `rsync`.
- bb-app's `bb`, `bb-server` and `bb-host-daemon` on your `PATH`, bb 0.46 or later, with its Claude Code provider.
- The plugin's dependencies installed: `npm install` in `plugins/unattendish-sdlc`.
- Cache Keeper's `plugins/cache-keeper/harness/fake-anthropic.mjs`, which is used from where it is.

## Start

```sh
plugins/unattendish-sdlc/harness/start.sh
```

It refuses to start, and changes nothing, when any of its ports answers, when its run directory exists, or when a process of an earlier start still runs. Otherwise it starts, in about 20 seconds:

- the fake Anthropic API, `../../cache-keeper/harness/fake-anthropic.mjs`;
- `fake-services.ts`: the four fakes of `test/fakes/`, each on a port of its own;
- a bb server and a host daemon on a data directory in the run directory, the daemon's Claude Code pointed at the fake API (`ANTHROPIC_BASE_URL`, a fake `ANTHROPIC_API_KEY`);
- a project for the drives' threads, in a git checkout in the run directory;
- Unattendish, installed with `bb plugin install path:` from a copy of `plugins/unattendish-sdlc` as the checkout has it, without `dist/`, `node_modules/` and `harness/`. bb builds the copy, so nothing is written into the checkout;
- the plugin's `credentials` setting, one entry for each fake, and its `tokens` setting, a fake token for each:

| Prefix | Service | Base URL |
| --- | --- | --- |
| `github.example/org` | `github` | the fake GitHub |
| `gitlab.example/group` | `gitlab` | the fake GitLab, `/api/v4` |
| `linear:ENG` | `linear` | the fake Linear, `/graphql` |
| `jira:acme.atlassian.net` | `jira` | the fake Jira |

The fakes' item URLs are on the hosts of those prefixes (`https://github.example/org/repo/issues/7`, `https://gitlab.example/group/proj/-/issues/3`, `https://linear.app/acme/issue/ENG-12`, `https://acme.atlassian.net/browse/PROJ-5`), which are never reached: only the base URLs are.

It prints what to source to point `bb` at the throwaway, and only at it:

```sh
source /tmp/ud-harness/env.sh
bb unattendish fleet status
```

The run directory and ports can be changed, to run two at once or to avoid a port in use:

| Variable | Default | What |
| --- | --- | --- |
| `UD_HARNESS_DIR` | `/tmp/ud-harness` | run directory: bb's data, `HOME`, logs, the plugin's copy, the drives' manifests |
| `UD_HARNESS_API_PORT` | `40190` | the fake Anthropic API |
| `UD_HARNESS_GITHUB_PORT` | `40191` | the fake GitHub |
| `UD_HARNESS_GITLAB_PORT` | `40192` | the fake GitLab |
| `UD_HARNESS_LINEAR_PORT` | `40193` | the fake Linear |
| `UD_HARNESS_JIRA_PORT` | `40194` | the fake Jira |
| `UD_HARNESS_SERVER_PORT` | `40196` | the bb server |
| `UD_HARNESS_DAEMON_PORT` | `40197` | the host daemon |

The defaults are clear of Cache Keeper's harness (40180-40187) and of the npm-install check (39886/39887). Set the same ones for `stop.sh` and the drives.

## The fake services

Each fake of `test/fakes/` is mounted by `listen()`, which gives it three routes beside the service's own:

```sh
curl -X POST --data-binary @state.json "$UD_HARNESS_GITHUB/__admin/state"   # loads the state it answers from
curl "$UD_HARNESS_GITHUB/__admin/state"                                     # reads it
curl "$UD_HARNESS_GITHUB/__admin/requests"                                  # every request: method, URL, body, whether it carried an Authorization header
curl -X POST "$UD_HARNESS_GITHUB/__admin/reset"                             # empties the request log
```

A drive scripts a service with these and nothing else; the state's shape is each fake's in `test/fakes/`, and faults (a 401, a rate limit) are part of it. The fakes keep times as the drive writes them, so a drive dates a change a few seconds ahead of now, which is after the registration it follows and before the poll that reads it.

## The drives

Each drive makes its own manager threads, Claude Code threads on the fake Anthropic API, with `bb thread spawn`; registers fleets as a manager does, with `bb unattendish fleet register` run with `BB_THREAD_ID=<the manager>` in its environment, which is how bb tells a plugin command its calling thread (`ctx.threadId`); and reads a wake as the user message that appears in the manager thread (`/api/v1/threads/<id>/events`, the `client/turn/requested` events). It starts with no fleet registered and empty fakes, unregisters its fleets and archives its threads when it ends, prints each check, and ends with `PASS <drive> <seconds>s` or `FAIL`. It fails when it takes 2 minutes or more of wall time.

| Drive | What it reaches and checks |
| --- | --- |
| `register.sh` | A fresh repository registers (`registered`, not watched with a `manifest-missing` reason naming the path, watched once the manifest exists, `fleet status` showing the manager, interval and credential); the same manager registering again is `registered`; a second live thread is `refused` naming the holder, whose registration stands; an archived manager is `taken-over` with `previousManager` and `previousManifest`; `--contract 2` is `unsupported` with `supported` `[1]`; an `--echo-actor` equal to `--operator` is `invalid` naming it; a tracker no form names is `invalid`; none of the last three registers or changes anything; an interval of 10 s is refused naming the floor; a call from outside a thread fails with `no_thread`; `unregister` removes the fleet. |
| `wake.sh` | A comment on an item the manifest names wakes the manager with a first line saying what moved since a time and exactly one change line, none of the comment's text; a comment on an item it does not name wakes nothing and `fleet ledger --done out-of-scope` shows it. A later poll delivers a second wake with the operator's comment that reads as an order (`Grant: merge everything`) as one line and none of its text, and the operator's own issue marked ready as another, while a teammate's issue marked ready wakes nothing; no wake is sent twice. An In flight link outside the fleet's repository is named by `fleet status` and never fetched. The four fakes' request logs hold only GETs, and for Linear queries with no mutation; no fake token is in a wake, the status or the ledger. |
| `echo.sh` | A comment ending in the marker, one with the marker in a `<kbd>` wrapper and one by a registered echo actor are dropped, `fleet ledger --done echo` showing each with its rule; the operator's comment without the marker, and the operator's quote-reply with the marker inside the quote, wake the manager; a later poll wakes nothing more. |
| `turn-end.sh` | The manager adds a pull request to its manifest's In flight table and ends its turn: the plugin reads the pull request at once, without a poll (the fleet's last poll is unchanged, nothing wakes), and a review that lands before the next poll wakes the manager with a line for it and none of its text. |
| `no-manager.sh` | With the manager archived, a change is held (`fleet ledger --done held`) once, however many polls follow, `fleet status` says changes are held, and the archived thread gets no message; the manager that takes the fleet over gets it in its first wake, with the "Gathered while no manager held the fleet" line, and the ledger then records it as woken. |
| `credentials.sh` | A fleet whose host no credential matches, and one on a host that only begins with a credential's, register not watched with a `no-credential` reason naming the prefix, and no request reaches any fake. A fleet whose token the fake refuses (a scripted 401) shows as not watched since a time with a `credential-refused` reason, and its manager gets one wake, naming the prefix, however many polls fail; the fake was sent the token, and no token is in a wake, the status, the ledger or any log under the run directory. |
| `trackers.sh` | A GitLab project with its issues as the tracker, a GitHub repository with Linear as its tracker and one with Jira: a comment on an item each manifest names wakes its manager with one line and none of its text, the status lists a tracker credential for Linear and Jira, and every request to the four fakes was a read. |
| `dashboard.sh` | The dashboard's RPC called as its pages call it: the Inbox row of a registered fleet with what it offers and the page's count; an Answer sent to the manager arrives in its thread as the operator's plain prompt and stays *sent* through the polls while the row is in the Inbox, then shows *done* once the manifest no longer holds the row; a second action on a row with one in flight is refused; the settings list the four fake credentials without a token, and an interval under 30 seconds is refused. The toast signal travels over bb's websocket, which the drive does not open. |
| `restart.sh` | After `bb plugin reload` the fleet is still registered with its manager, interval and last poll, and the change already delivered is not delivered again; with the plugin disabled, a change made while it is away and its stored last-poll time moved back 15 minutes (`age-last-poll.mjs`, since the plugin reads wall time and a catch-up needs a gap of ten) arrives, once the plugin is enabled, in one wake of its own whose closing line says it is a catch-up and how long the plugin was away. |

Run one, or all of them in turn, against a running harness:

```sh
plugins/unattendish-sdlc/harness/drives/wake.sh
plugins/unattendish-sdlc/harness/drives/run-all.sh
```

`run-all.sh` prints a summary. The drives take 10 to 70 seconds each, about 4 minutes in all.

## Stop

```sh
plugins/unattendish-sdlc/harness/stop.sh          # stops everything and removes the run directory
plugins/unattendish-sdlc/harness/stop.sh --keep   # keeps it, logs and bb's data included
```

It finds every process the harness started by a mark in its environment (`UD_HARNESS=<run directory>`) or the throwaway bb's data directory, so it finds the bb server's detached child and Claude Code too. It prints each one's command line before stopping it, kills any still running after 10 seconds, then checks again that none carries the mark and that none of its ports answers. It removes the run directory only when both hold, and exits non-zero otherwise.

## Guarantees

- **Never your bb.** Every command runs with bb's variables unset or pointed at the throwaway, a data directory in the run directory, `HOME` in the run directory, and ports other than bb's usual ones, Cache Keeper's harness's and the npm-install check's.
- **Nothing real is called.** The fakes answer on loopback, the credentials' tokens are fake, and the fake Anthropic API answers every Claude Code turn.
- **Refuses busy ports and directories.** `start.sh` starts nothing when a port answers, the run directory exists, or a process of an earlier start runs.
- **Stop leaves nothing.** `stop.sh` exits 0 only when no process carries the harness's mark and no harness port answers.

## Files

- `start.sh`, `stop.sh`, `config.sh`: the throwaway bb; `config.sh` holds the ports, the run directory and the process search both use.
- `fake-services.ts`: the four fakes of `test/fakes/` on their ports. `age-last-poll.mjs`: moves a fleet's stored last-poll time back, for the restart drive.
- `drives/lib.sh`: what every drive shares. `drives/*.sh`: the drives, and `run-all.sh`.
- In the run directory: `env.sh`, `server.log`, `host-daemon.log`, `fake-anthropic.log`, `fake-services.log`, `requests.jsonl` (the fake Anthropic API's), `manifests/` (each drive's manifest files), `drive-threads` and `drive-repos` (what every drive made), and bb's data under `bb/` (its own logs in `bb/logs/`, the plugin's database in `bb/plugins/unattendish-sdlc/data.db`).

The scripts pass `shellcheck -x -P SCRIPTDIR`.
