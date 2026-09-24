# Team Onboarding: settings

Set these under Settings → Installed plugins → Team Onboarding, or with `bb plugin config team-onboarding set <key> <value>`. Source: [`server.ts`](../../plugins/team-onboarding/server.ts).

| Key | Label | Default | Meaning |
|---|---|---|---|
| `manifestFile` | Manifest file | empty | Absolute path to the team's manifest on the bb server. Empty reads `<data dir>/team-onboarding/onboarding.yaml` |
| `checkIntervalMinutes` | Check every (minutes) | `30` | How often every check runs in the background |

**Manifest file** accepts only an absolute path, without `..` or a trailing slash, to a file called `onboarding.yaml` or `onboarding.yml`. Agents can change settings with `bb plugin config`, so the plugin refuses any other file: a symlink is followed only to a file with one of those names, or into `/nix/store`. The file must be a regular file of at most 256 KiB.

Below the settings, a section shows the manifest file in use: its path, whether it is there, its sha256 and modification time, and any validation errors with their line.

A changed check interval applies within 5 minutes, without a reload. Between runs, checks also run when you press **Recheck** or **Recheck all**, when a machine reconnects, and when the manifest file changes.
