---
title: A plugin skill whose job overlaps a bb native skill loses the choice unless its description claims it
date: 2026-10-09
last_updated: 2026-10-26
category: best-practices
module: plugins
problem_type: best_practice
component: plugin skills
severity: medium
applies_when:
  - "Writing or shortening the description of a plugin skill that does what a bb native skill also claims, such as the sidebar list or AI task services"
  - "Naming a new setting in such a description"
  - "Trialling whether a plugin skill's description still fires"
  - "Writing what such a skill's body tells an agent to send to bb's own list"
tags: [skill-description, trigger, native-skill, thread-glance, thread-list, trialling, false-green]
retire_when: "bb withdraws its native thread-list skill while another sidebar list is selected, or lets a skill's availability follow the selected list; check the thread-list plugin's skills and agents.configure in the bb release notes"
---

# A plugin skill whose job overlaps a bb native skill loses the choice unless its description claims it

## Context

bb ships native skills for some of what this repository's plugins replace or
extend: thread-list for the sidebar list Thread Glance replaces, and
bb-cloud-ai for the AI tasks openai-inference serves. Per the research done
for #184 on bb 0.45.0, every enabled plugin's skill descriptions sit beside
bb's own in every thread, and an agent picks between them from the
descriptions alone. It cannot see which sidebar list the user has selected
without running a command. Only a plugin's own `bb.agents.configure` filters
its skills, so nothing withdraws thread-list while Thread Glance is the list
in use. bb 0.47.1 still ships thread-list's skill.

When thread-glance's description was shortened (#184), trials against bb's
thread-list showed that a description saying only what the skill does loses
to thread-list. When #345 named three new settings in it, a first draft
listed "Group by worktree" beside the other settings, ahead of "and how the
sidebar groups, sorts, hides, collapses, folds and settles threads". "Group my
sidebar by machine instead of by project." then went to thread-list in 5 of 5
sonnet runs, where the description before it kept that prompt on
thread-glance in 3 of 3.

## Guidance

- The description of a plugin skill that overlaps a native one does three
  things:
  - It says the skill is the one to use while its plugin is installed.
  - It names the native command it displaces.
  - It names every kind of request the native skill would also catch, by the
    general verb (*groups*, *sorts*, *hides*).

  In #345's trials the clause and the verbs together carried the routing,
  not the names of settings. The description from before #345, with both and
  none of the new names, already won the three new settings' prompts in 24 of
  24 runs on opus, sonnet and haiku. A description with neither, cut to
  "shelves, snooze, park and project colours", reached thread-glance in none
  of 18 runs, 17 of them going to thread-list. Removing the clause alone did
  not lose on opus, 12 of 12; no trial removed the verbs alone.

- Naming one more setting can take an earlier prompt away, so a rewording is
  trialled on the old prompts as well as the new. Why the first #345 wording
  lost "by machine" is not settled: three rewordings each held it 3 of 3 on
  sonnet, one of them still listing "Group by worktree" as a peer item and
  differing from the losing wording only by "for every sidebar change". The wording kept in
  `plugins/thread-glance/skills/thread-glance/SKILL.md` reads awkwardly on
  purpose, "how the sidebar groups (Group by worktree among them), sorts,
  hides, collapses, folds and settles threads", and held 6 of 6 on sonnet.

- A rewording is trialled against the competing native `SKILL.md` installed
  beside it, on the prompts it adds and on the earlier ones it could take
  away, since a trial without the competitor has nothing to lose to. bb ships
  the native skills under `server/dist/builtin-plugins/<plugin>/skills/` in
  the bb-app package.

- The trial puts a `bb` stand-in first on PATH, since the sessions run with
  `--permission-mode bypassPermissions` and a real `prefs set` changes the
  user's sidebar. The stand-in logs each command, keeps the values set and
  rejects the values bb rejects, for every key of the native list, written
  from its schema in the bb-app package's
  `server/dist/builtin-plugins/thread-list/dist/server.js`
  (the `definePreference` calls): one that answers every command with success
  lets a run report a change made with a value bb would reject, and one that
  checks only the keys under change passes the earlier prompts that send a
  bad value to another key. #369's stand-in checked `organizationMode`,
  `environmentGrouping` and two booleans, and took any value for the other
  keys; in #371 one written from the schema showed
  "Sort my sidebar threads by title." sending `chronologicalSort title`,
  which bb 0.47.1 rejects, on the base as on the head, since the descriptions
  `bb thread-list prefs list` prints leave the sort's values out.

- Where the body sends a request to `bb thread-list prefs set`, each value it
  names is a claim about what bb's list then shows, read in the bb-app
  package's `server/dist/builtin-plugins/thread-list/dist/app.js`, not only that the schema accepts it. In bb
  0.47.1 the schema accepts `chronologicalSort none`, which the list sorts as
  `updated`, so a body naming `none` let an agent report an unsorted sidebar
  that never changed, in a sonnet run of #371's review; and the list ignores `environmentGrouping` while
  `groupByReadStatus` is `true`, so "already grouped" is false there whatever
  `environmentGrouping` holds.

- Under Claude Code, a fixture holding the two skills and none of the user's
  own, only Claude Code's bundled ones, was a scratch directory with
  `.claude/skills/<name>/SKILL.md`, run as
  `claude -p "<prompt>" --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json --verbose < /dev/null`;
  the skill that fired is the `Skill` tool call in the stream. Without
  `< /dev/null`, a piped `claude -p` writes a "no stdin data received" warning
  to stderr, and a stream file that merges stderr then fails `jq`.

- The body tells the agent how to check which list is active, with
  `bb settings ui get sidebar.threadListProvider`.

## Why This Matters

The mistake fails silently. `bb thread-list prefs` succeeds, so the agent
reports the change done, while the sidebar the user sees stays as it was.
Nothing errors, so only a trial run against the competitor shows the
description losing, and only a trial of the old prompts shows a new name
taking one away.

## When to Apply

- Rewording or trimming the description of any plugin skill whose subject a
  bb native skill also covers.
- Naming a new setting or feature in such a description.
- Adding a plugin skill for something bb already has a native skill for.
- Trialling such a skill's trigger.
- Naming in such a skill's body a value for an agent to send to bb's own list.

## Examples

openai-inference overlaps bb-cloud-ai on missing thread titles. Its
description ties the trigger to its own Endpoints ("Use when such a server
gives no titles") rather than claiming every missing title. In trials, one
run each, a gateway prompt went to openai-inference and a bare "My threads
get no title" went to bb-cloud-ai, which is the right owner for a user without
Endpoints.

## Related

- #184: the first rewrite against the native skills, and its trial table.
- #345: the description naming Thread display, Project icon only and Group by
  worktree; its trial table is on the pull request that closes it.
- #371: the body answering group by worktree under bb's own list, trialled
  with a stand-in written from bb 0.47.1's schema; its trial is on the pull
  request that closes it.
- #183: the `AGENTS.md` rule to write skills and agent tool descriptions with
  `writing-for-agents`.
