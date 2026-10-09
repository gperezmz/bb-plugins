---
name: team-onboarding
description: Reads and fixes the team setup checklist on each machine with `bb team-onboarding`. Use when an engineer asks if their bb setup is complete, why git or an agent fails on a machine, or to set one up.
---

# Team onboarding checklist

`bb team-onboarding --help` lists the commands. They run on the bb server, and
`--machine <name>` picks the machine; the default is the machine of the thread
that runs them.

Statuses: `ok`, `todo` (never passed), `broken` (passed before), `update`,
`needs-approval`, `unknown` (machine offline or the check couldn't run),
`skipped` (not needed there).

- Safe fixes are the only fixes the CLI runs: an SSH key when none exists,
  GitHub's pinned host keys, the plugin's SSH config, `gh auth setup-git`,
  installing team skills not yet installed, and installing plugins and
  marketplaces the engineer already approved.
- Run `manifest install` only when the engineer asks you to.
- Approvals of team commands, plugin and marketplace sources and tool installs
  happen in the **Onboarding** page only. No command approves anything; don't
  look for a way around that.
- Logins (GitHub, agents) need the engineer: point them at the Onboarding
  page, which shows the one-time code or opens a terminal.
- Never print or store tokens. `gh auth token` output and machine variable
  values stay out of the conversation.
