---
title: A review that mutates code must not run in a checkout another session edits
date: 2026-10-13
last_updated: 2026-10-13
category: workflow-issues
module: reviewing-code
problem_type: workflow_issue
component: review
severity: medium
applies_when:
  - "Running a review or verification subagent that edits source to break it, runs a test, then reverts"
  - "Spawning a review thread for a change while the parent session still has uncommitted edits in that worktree"
tags: [mutation-check, shared-worktree, review-subagent, git-checkout, wait-loop]
---

# A review that mutates code must not run in a checkout another session edits

The tests lens of the `reviewing-code` skill checks that a test fails when behaviour breaks. A
reviewer that proves a break by editing the code under review to a broken variant and running
the test puts that edit in whatever working tree it runs in. Run in a checkout the parent
session is still editing, the edit lands in the parent's working tree.

## Context

Per this session's conclusion, the review of the #271 change ran its tests lens as a bb thread
in the parent's worktree. The parent had uncommitted review fixes in
`plugins/unattendish-sdlc/src/fleet/adapters/cli.ts` (comment and help-text wording). The thread
mutated `cli.ts` in place, and its cleanup ran `git checkout -- cli.ts`, which restored the file
from the index, which matched the branch's commit, and erased the parent's unstaged fixes. The
parent had to re-apply them. The same thread also started a wait loop on a result file it had
been told to stop producing; the loop outlived the thread's run until the parent killed it.

## Guidance

- Run each mutation in a copy, never in a checkout another session edits. Either a detached
  worktree of the commit under review (`git worktree add --detach <dir> <head>`, removed after
  with `git worktree remove --force <dir>`), or a copy of the one file mutated.
- Revert by restoring the saved original, not by `git checkout -- <file>`. The checkout
  rewrites the file from the index, so it drops any unstaged edit the parent made.
- Spawn a review thread that mutates code with its own worktree (`--new-environment worktree`),
  not with the shared-checkout environment flag (`--environment`).
- Name the worktree to mutate in by its path, from `pwd` or `git rev-parse --show-toplevel`
  of the checkout the brief names. Picking one out of `git worktree list` (`| tail -1`) took
  another session's detached worktree under `/tmp` on #297 (per that reviewer's own report): it edited tracked
  files and ran `git checkout -q -- .` in it five times, which would throw away any
  uncommitted change its owner held.
- Bound every wait the reviewer runs. A `timeout` on the wait, and a failure path when it
  expires. Never an open `until` loop on a file that only the reviewer could produce.

## Why This Matters

A mutation edit in a shared checkout does two kinds of damage. The revert can erase another
session's unstaged work with no warning, since git reports nothing when `checkout --` overwrites
a modified file. And a reviewer that waits on a result it was told not to produce keeps a shell
loop running after its thread has finished, which only the parent notices.

## When to Apply

- Before a review or verification subagent edits any file to run a mutation.
- When a review or verification is spawned for a change still being edited in the same tree.
- When a reviewer's brief asks it to wait for a file or output that depends on its own run.

## Examples

Mutate in a copy of the commit, not in the parent's tree:

```sh
dir="$(mktemp -d "${TMPDIR:-/tmp}/review-mutation.XXXXXX")"
git worktree add --detach "$dir" <head>
# edit "$dir/<file>" to the broken variant and run the test from "$dir"; no revert is needed
git worktree remove --force "$dir"
```

Bound the wait, instead of looping forever on a result. `out` must be exported, since the inner
`sh` reads it from the environment:

```sh
export out=<the result file>
timeout 120 sh -c 'until grep -q "M5" "$out"; do sleep 3; done' || echo "no M5 result; treating M5 as not run"
```

## Related

- #297 (a review thread mutated another session's worktree, found with `git worktree list`)
- #271 (the issue whose change this review covered), and #272 (its pull request, merged).
