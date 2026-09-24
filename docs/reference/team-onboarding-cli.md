# Team Onboarding: `bb team-onboarding`

The CLI runs on the bb server. `--machine <name>` picks the machine, by its name in Settings → Machines; the default is the machine of the thread that runs the command. It runs [safe fixes](team-onboarding-items.md#safe-fixes) only, and cannot approve anything. Source: [`server.ts`](../../plugins/team-onboarding/server.ts).

| Command | Does |
|---|---|
| `bb team-onboarding status [--json]` | Prints the checklist: progress, then each group's items with their status per machine |
| `bb team-onboarding check [<itemId>]` | Runs the checks again, all or one item, with nothing reused from earlier runs, and prints the checklist |
| `bb team-onboarding fix <itemId> [--machine <m>]` | Runs that item's safe fixes on the machine, and prints the manual steps for the rest |
| `bb team-onboarding apply --safe [--machine <m>] [--json]` | Runs every safe fix on one machine and lists what is left by hand. `--safe` is required |
| `bb team-onboarding manifest path` | Prints where the plugin reads the manifest on the server, with ` (not there yet)` when the file is missing |
| `bb team-onboarding manifest validate <file> [--machine <m>]` | Validates a manifest on that machine. Prints `Valid: <team name>.`, or each error with its line |
| `bb team-onboarding manifest install <file> [--machine <m>]` | Validates a manifest, then writes it where the plugin reads it: atomically, mode 0644. An invalid file changes nothing |

`<file>` is relative to the current directory on the machine it is on. Item ids are listed in [items](team-onboarding-items.md#items) and by `status`.

`status --json` prints `{ badge, progress, manifest, items }`. Each item has `id`, `title`, `required`, `status`, `results` (one per machine) and `safeFixes`.

`apply --safe` is meant for machine bootstraps: see [provision a manifest from a machine bootstrap](../how-to/team-onboarding-provision-manifest.md).

The plugin's agent skill documents these commands for agents, and tells them that logins and approvals need the engineer in the Onboarding page.
