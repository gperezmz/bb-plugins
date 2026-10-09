---
title: A plugin skill whose job overlaps a bb native skill loses the choice unless its description claims it
date: 2026-10-09
category: best-practices
module: plugins
problem_type: best_practice
component: plugin skills
severity: medium
applies_when:
  - "Writing or shortening the description of a plugin skill that does what a bb native skill also claims, such as the sidebar list or AI task services"
  - "Trialling whether a plugin skill's description still fires"
tags: [skill-description, trigger, native-skill, thread-glance, thread-list, trialling]
retire_when: "bb withdraws its native thread-list skill while another sidebar list is selected, or lets a skill's availability follow the selected list; check the thread-list plugin's skills and agents.configure in the bb release notes"
---

# A plugin skill whose job overlaps a bb native skill loses the choice unless its description claims it

## Context

bb ships native skills for some of what this repository's plugins replace or
extend: thread-list for the sidebar list Thread Glance replaces, and
bb-cloud-ai for the AI tasks openai-inference serves. Per this session's
research on bb 0.45.0, every enabled plugin's skill descriptions sit beside
bb's own in every thread, and an agent picks between them from the
descriptions alone. It cannot see which sidebar list the user has selected
without running a command. Only a plugin's own `bb.agents.configure` filters
its skills, so nothing withdraws thread-list while Thread Glance is the list
in use.

When thread-glance's description was shortened (#184, pending as of
2026-10-09), trials against bb's thread-list showed that a description saying
only what the skill does loses to thread-list. The old description picked
thread-glance on "Group my sidebar by machine" in 0 of 2 runs. The shortest
rewrite picked it in 1 of 2. Adding "when Thread Glance is its list" lifted
grouping to 2 of 2, but dropped "collapses" and "folds", and those prompts
then went to thread-list.

## Guidance

- The description of a plugin skill that overlaps a native one does three
  things:
  - It says the skill is the one to use while its plugin is installed.
  - It names the native command it displaces.
  - It names every kind of request the native skill would also catch.

  The wording in
  [`plugins/thread-glance/skills/thread-glance/SKILL.md:3`](../../../plugins/thread-glance/skills/thread-glance/SKILL.md)
  reads awkwardly and is kept on purpose, because each smoother wording
  tried lost trials:

  ```text
  Sets how the sidebar groups, sorts, hides, collapses, folds and settles threads via `bb thread-glance prefs`. Use as the tool for sidebar changes with Thread Glance installed, not `bb thread-list`.
  ```

- A trigger trial for such a skill installs the competing native `SKILL.md`
  beside it. In bb 0.45.0 these are under
  `server/dist/builtin-plugins/<plugin>/skills/` in the bb-app package. A
  trial without the competitor has nothing to lose to and always passes.
- The trial puts a `bb` shim on PATH that logs each command and prints
  canned output, since `trialling-skills` runs its sessions with
  `--permission-mode bypassPermissions` and a real
  `bb thread-glance prefs set` changes the user's sidebar.
- The body tells the agent how to check which list is active, at
  `plugins/thread-glance/skills/thread-glance/SKILL.md:9`.

## Why This Matters

The mistake fails silently. `bb thread-list prefs` succeeds, so the agent
reports the change done, while the sidebar the user sees stays as it was.
Nothing errors, so only a trial run against the competitor shows the
description losing.

## When to Apply

- Rewording or trimming the description of any plugin skill whose subject a
  bb native skill also covers.
- Adding a plugin skill for something bb already has a native skill for.
- Trialling such a skill's trigger.

## Examples

openai-inference overlaps bb-cloud-ai on missing thread titles. Its
description ties the trigger to its own Endpoints ("Use when such a server
gives no titles") rather than claiming every missing title. In trials, one
run each, a gateway prompt went to openai-inference and a bare "My threads
get no title" went to bb-cloud-ai, which is the right owner for a user without
Endpoints.

## Related

- #184 (pending as of 2026-10-09): the rewrite and the trial table in its
  description.
- #183: the `AGENTS.md` rule to write skills and agent tool descriptions with
  `writing-for-agents`.
