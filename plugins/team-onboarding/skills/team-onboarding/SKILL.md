---
name: team-onboarding
description: Reads and fixes the team setup checklist with `bb team-onboarding` (GitHub access, SSH, agent logins, team skills, plugins, tools, team checks on every machine). Use when an engineer asks whether their bb setup is complete, why git or an agent fails on a machine, or to set up a new machine.
---

# Team onboarding checklist

`bb team-onboarding` reads the team's manifest and checks each item on every
machine it applies to. It runs on the bb server; `--machine <name>` picks
the machine, and the default is the machine of the thread that runs it.

| Command | What it does |
|---|---|
| `bb team-onboarding status [--json]` | Every item with its status per machine and the safe fixes. |
| `bb team-onboarding check [itemId]` | Runs the checks again and prints the result. |
| `bb team-onboarding fix <itemId> [--machine <m>]` | Runs that item's safe fixes and prints the manual steps for the rest. |
| `bb team-onboarding apply --safe [--machine <m>]` | Runs every safe fix on one machine and lists what is left by hand. |
| `bb team-onboarding manifest validate <file>` | Validates an `onboarding.yaml` on this machine; errors name the line. |
| `bb team-onboarding manifest path` | Prints where the plugin reads the team manifest on the bb server. |
| `bb team-onboarding manifest install <file>` | Validates an `onboarding.yaml` and installs it there (atomic; an invalid file changes nothing). Only when the engineer asks you to. |

Statuses: `ok`, `todo` (never passed), `broken` (passed before), `update`,
`needs-approval`, `unknown` (machine offline or the check couldn't run),
`skipped` (not needed there).

## What you may and may not do

- Safe fixes are the only fixes the CLI runs: an SSH key when none exists,
  GitHub's pinned host keys, the plugin's SSH config, `gh auth setup-git`,
  installing team skills not yet installed, and installing plugins and
  marketplaces the engineer already approved.
- Approvals of team commands, plugin sources and tool installs happen in the
  **Onboarding** page only. No command approves anything; don't look for a
  way around that.
- Logins (GitHub, agents) need the engineer: point them at the Onboarding
  page, which shows the one-time code or opens a terminal.
- Never print or store tokens. `gh auth token` output and machine variable
  values stay out of the conversation.
