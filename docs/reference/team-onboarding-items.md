# Team Onboarding: items, statuses and safe fixes

An **item** is one line of the checklist: a check, zero or more fixes, and the machines it applies to. Some items are built in; the rest come from the team's [manifest](team-onboarding-manifest.md). Sources: [`src/core/items.ts`](../../plugins/team-onboarding/src/core/items.ts), [`src/core/vocab.ts`](../../plugins/team-onboarding/src/core/vocab.ts), [`src/core/fixes.ts`](../../plugins/team-onboarding/src/core/fixes.ts).

## Items

Ids are what `bb team-onboarding check` and `fix` take. The page groups items in this order: GitHub, SSH, Agents, Skills, Plugins, Tools, Environment, Team checks, and **Nice to have** for every item that is not required.

### Built in

These run with or without a manifest.

| Id | Title | Runs on | Checks |
|---|---|---|---|
| `github.gh-installed` | GitHub CLI on the server | server | `gh` is on the server's `PATH` |
| `github.login` | Log in to GitHub | server; every machine in `per-machine` mode | gh is logged in with the scopes the manifest asks for, or agents get a working `GH_TOKEN` |
| `github.builtin-git` | bb's built-in git | every machine | Agents on the machine reach GitHub through the server's login. Absent in `per-machine` mode, where `github.mode` replaces it |
| `agent:<provider>` | The provider's name | every machine | The agent is installed, logged in and recent enough. Without a manifest, one per agent bb knows |
| `core.bb-version` | bb version | server | A newer bb is available. Not required |
| `core.manifest` | `<team name> manifest`; Your team's manifest when the file can't be used and none loaded before | server | The manifest file loads. Absent when there is no file |

### From the manifest

| Id | From | Checks |
|---|---|---|
| `github.mode` | `github.mode: per-machine` | bb's built-in git is turned off, so each machine uses its own login |
| `github.access:<id>` | `github.access` | Agents can read the repository |
| `ssh.key` | `ssh` | An ed25519 key `bb_ed25519` exists with mode 0600 |
| `ssh.known-hosts` | `ssh` | GitHub's host keys, pinned in the plugin, are in bb's known-hosts file |
| `ssh.config` | `ssh` | git's `core.sshCommand` uses the plugin's SSH config |
| `ssh.uploaded` | `ssh` | GitHub accepts the key |
| `ssh.signing` | `github.signing.required` | A test commit signed with the key verifies |
| `skill:<id>` | `skills` | The skills are installed and match the source |
| `skills.removed` | `skills` | No skill the team dropped from the manifest is still installed |
| `marketplace:<id>` | `marketplaces` | The marketplace is added |
| `plugin:<id>` | `plugins` | The plugin is installed, up to date, and has the entry's `settings` |
| `tool:npm` | a `git:` plugin source | `npm` is on the server, which a git plugin install needs |
| `tool:<id>` | `tools` | The program is on the machine's `PATH`, and its version is at least `min` when the entry sets one |
| `env:<name>` | `env` | The machine variable is set |
| `check:<id>` | `checks` | The team command exits 0 |

On a machine with no `bb_ed25519` key, where git over SSH already reaches GitHub with the user's own SSH setup, `ssh.key`, `ssh.known-hosts`, `ssh.config` and `ssh.uploaded` pass and change nothing.

## Statuses

Each item has a status on each machine:

| Status | Means | Shown as |
|---|---|---|
| `ok` | Passes | Green |
| `todo` | Has never passed on this machine | Hollow grey circle, "To do" |
| `broken` | Passed before and fails now, e.g. an expired login | Red |
| `update` | Works, but a newer version is available, or a synced skill was edited locally | Amber |
| `needs-approval` | Waits for the engineer to [approve](#approvals) a team check's `run`, a plugin or a marketplace | Amber |
| `unknown` | The machine is offline, or the check could not run | Dimmed, with when the machine was last seen |
| `skipped` | Not in scope on this machine | Not counted |

An item's own status is the worst over the machines in scope that are online; `unknown` and `skipped` never make it fail. A machine offline for more than 7 days becomes `skipped`. The checklist then lists it above the groups, with **Forget this machine**, whatever its results are.

The sidebar badge counts required items that are `todo`, `broken` or `needs-approval`. It shows a dot when only updates remain, and a check mark when every required item is `ok`.

## Safe fixes

A **safe fix** is idempotent, needs no input, and runs no code the engineer has not approved. Only safe fixes run from the CLI, from **Fix all safe items**, or through `bb plugin rpc call`; no fix runs without one of those or a click in the page. The complete list:

- `ssh-keygen`, only when no key exists;
- writing GitHub's pinned host keys;
- writing the plugin's SSH config and `core.sshCommand`;
- `gh auth setup-git`;
- installing team skills from `git`, `apm` and `registry` sources that are not installed yet (updates are manual);
- installing approved plugins and adding approved marketplaces.

`gh ssh-key add` writes to the GitHub account, so it is not safe. A team's own fix is never safe. A file that is read-only on the machine (one linked from the Nix store, say) gets no write at all: the item shows the lines to add where you manage that file.

## Approvals

An **approval** is the engineer's recorded consent to run something the manifest names:

- a **team command**: `checks[].run`, `checks[].fix`, `tools[].install`;
- a plugin or marketplace source.

An approval is given in the Onboarding page and nowhere else: under **Commands from your team** in the item's row, or on the **Team manifest** tab. **Revoke** sits in the same two places. It is stored per hash of the command or source, its item and its machine rule, so changing any of them needs approval again, and approvals of commands no longer in the manifest lapse. [Approve your team's commands](../how-to/team-onboarding-approve-commands.md) has the steps; [why approvals happen only in the page](../explanation/team-onboarding-checks.md#why-approvals-happen-only-in-the-page) explains the rule.

A team check waits in `needs-approval` until its `run` is approved, and a plugin or marketplace until its source is. An unapproved `fix` or tool `install` leaves the item's status to its check, and the item offers **Review and approve** in place of that fix. Approving or revoking checks the item again at once.
