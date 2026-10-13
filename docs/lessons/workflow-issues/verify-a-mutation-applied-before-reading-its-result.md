---
title: A mutation that did not apply reads as a clean run; confirm it applied before reading the test
date: 2026-10-13
category: workflow-issues
module: plugins/cache-keeper/harness
problem_type: workflow_issue
component: mutation check
severity: medium
applies_when:
  - "writing a mutation check that deletes or rewrites a line of a generated shell file to prove a test goes red"
  - "a mutation run passes every case with the same count as the unmutated run"
tags: [mutation-check, false-green, sed, heredoc, shell, run-env]
---

# A mutation that did not apply reads as a clean run; confirm it applied before reading the test

## Context

Spec #296 (open as of 2026-10-13) adds a case to `plugins/cache-keeper/harness/run-env.test.sh`. To show
the case goes red, the mutation deletes the un-export loop in `run_env_script`,
`while read -r _ _ _v; do export -fn "$_v"; done < <(declare -Fx)`
(`plugins/cache-keeper/harness/run-env.sh:186`). The loop is written inside an
unquoted heredoc (`cat << ENV`), so in the source file its dollar sign is
backslash-escaped: the file reads `"\$_v"`, while the `env.sh` it generates
reads `"$_v"`.

## Symptoms

The first mutation used `sed -i '/export -fn "\$_v"/d'`. It matched no line,
and the test ran on the unmutated file: 22 PASS, exit 0. Read on its own, that
looks like a check that stays green when the behaviour breaks.

## What Didn't Work

Reading the test result alone. The exit status and the PASS count are the same
whether the mutation applied or not, so a run that changed nothing looks like a
passing check.

## Solution

Before reading the result of a mutation run, confirm that the file changed:

- count the lines the pattern should remove, before and after
  (`grep -c 'declare -Fx' run-env.sh` goes from 1 to 0);
- `git diff` the mutated copy against the commit it started from, and check the
  changed-line count is not zero;
- match on a plain fragment such as `declare -Fx` rather than on text the
  heredoc escapes.

Only then run the test, and read its `FAIL` line and exit status.

## Why This Works

A mutation proves a check can go red only if the mutated file differs from the
original. When the edit matches nothing, the run is a run of the original, and
its green result says nothing about the check. Confirming the edit landed makes
a clean result mean what it says.

## Prevention

For #296, the proof is the `FAIL` line naming the case with exit status 1, read
only after the count and the diff show the line removed. Keep the count and the
diff in the same command as the test run, so the result cannot be read without
them.

## Related

- [A review that mutates code must not run in a checkout another session edits](review-mutations-in-shared-worktree.md)
- [Keeping the caller's environment out of a drive run, and proving it by name](../developer-experience/keep-the-caller-environment-out-of-a-drive-run.md)
- #296
