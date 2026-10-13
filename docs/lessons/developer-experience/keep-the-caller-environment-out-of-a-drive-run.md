---
title: Keeping the caller's environment out of a drive run, and proving it by name
date: 2026-10-13
category: developer-experience
module: plugins/cache-keeper/harness
problem_type: developer_experience
component: drive harness
severity: high
applies_when:
  - "changing what a drive harness passes a run, run-env.sh's passed list or the names a run sets itself"
  - "a run's doctor or start reports a leak of a variable nobody passed, such as NIX_PATH, EDITOR or TERM in a bash or sleep process"
  - "trying to change the shell a run's Claude Code runs its commands in"
  - "verifying that no credential reaches a run's processes, Chromium included"
  - "a run's captures differ from the base in what the drives' repository is called or which branch it is on"
tags: [driving, harness, environment, leak, claude-code, nixos, gh, verification]
---

# Keeping the caller's environment out of a drive run, and proving it by name

## Context

Spec #281 (pending, unmerged as of 2026-10-13) has every drive harness start each process of a run from `env -i` with the passed list in `plugins/cache-keeper/harness/run-env.sh:19`, after a verifier printed the operator's `GH_TOKEN` from a run's processes. Building it showed that `env -i` is not the whole of what a run's processes hold: Claude Code, bb and the machine add to it from inside the run, and a check that looks for the caller's variables there meets them.

## Guidance

- **A run's Claude Code picks its own bash.** Given a wrapper script as `SHELL`, and as `CLAUDE_CODE_SHELL` too, a driven run's Claude Code still ran its commands as the real bash binary (`bash -c`, sourcing its shell snapshot) and set `SHELL` and `CLAUDE_CODE_SHELL` to that bash (*per this session's drive; Claude Code's own code was not read*). A wrapper did not change how those commands start in that drive; the environment Claude Code inherits did.
- **On NixOS, every bash Claude Code starts reads the machine's profile.** Its non-interactive `bash -c` reads `/etc/bashrc`, which returns at once when `NOSYSBASHRC` is set (`/etc/bashrc:4` on this machine) and otherwise sources `/etc/profile` (`/etc/bashrc:10-11`; *why bash reads it there was not settled*). The profile's `NIX_PATH`, `EDITOR`, `TERM`, `__ETC_PROFILE_DONE` and the like then appear in every command a run's thread runs, with the same values the caller holds, and the leak check reports them. `NOSYSBASHRC=1` in the run's environment keeps them out (`plugins/cache-keeper/harness/run-env.sh:68`); `run-env.test.sh`'s case for a bash started with the run's environment fails when `NOSYSBASHRC=1` is dropped from it (*per this session's mutation check*).
- **Do not exempt a value because the machine's profile sets it.** That exemption was built once and removed on the ruling recorded on #281: it would let a credential a machine-wide profile exports reach a run unreported. A name a run sets itself goes on `run_env_set_by_run` (`plugins/cache-keeper/harness/run-env.sh:38`) by name, with why.
- **bb's server hands its threads whatever `gh auth token` gives it** (*per the risks review of #281, read from bb's bundle*). With `HOME` in the run, gh finds no `hosts.yml`, but it can still ask a keyring over the user's D-Bus session bus, which `$XDG_RUNTIME_DIR/bus` reaches (*per the same review; not reproduced, since this machine keeps its token in `hosts.yml`*). A run therefore gets `DBUS_SESSION_BUS_ADDRESS=disabled:` and no `XDG_RUNTIME_DIR`, and doctor and both `start.sh` fail when `gh` inside the run finds a token (`plugins/cache-keeper/harness/run-env.sh:137`). A drive that puts a fake `gh` first on `PATH`, as [the TLS-proxy lesson](drive-a-token-flow-to-a-real-host-behind-a-tls-proxy.md) describes, must make its fake refuse `auth token` with no `--user`, or that check fails the start.
- **A run's git reads the run's `HOME`,** so `git init` there starts on git's own default branch, not the caller's `init.defaultBranch`, and captures of the drives' repository change (`master` where the base showed `main`). The harnesses read the caller's setting and pass it to `git init -b` (`.agents/skills/driving-bb-plugins/drive-bb-plugins:102` and `:328`, `plugins/cache-keeper/harness/start.sh:98`, `plugins/unattendish-sdlc/harness/start.sh:110`). Anything else a run's tools read from the caller's dotfiles is lost the same way.
- **Prove a leak by name and never by value.** Test each process with `grep -qz '^NAME=' /proc/<pid>/environ` and report the exit status; print no environment and no command line. Chromium overwrites its own `/proc/<pid>/environ` with its process title (*per #281's verification drive*), so read a run's Chromium through its `chrome_crashpad` child, which inherits the environment and the run's mark. Give the check a control on the base, whose runs hold every caller name but the few bb and Anthropic ones it unsets, so a probe that finds nothing is known to be able to find something.

## Why This Matters

Without these, the next change to the passed list or the run's shell either breaks the leak check with reports of variables nobody passed, invites an exemption that reopens the leak #281 closed, or tries a wrapper that a drive shows Claude Code ignoring. And a verifier checking a run by printing what its processes hold prints the operator's credentials, which is how #281 began.

## When to Apply

When changing `run-env.sh` or how a harness starts a run's processes, when a run's doctor or `start.sh` reports a leak of a name nobody passed, when changing the shell Claude Code runs in, when verifying that no credential reaches a run, and when a run's captures differ from the base in its repository's branch.

## Examples

Per this session's drives, a `--background` thread's `sleep 1800` in a run started without `NOSYSBASHRC` held `__ETC_PROFILE_DONE` and `NIX_PATH` while the bash that started it held neither at exec: that bash sourced the profile through `/etc/bashrc` before running the command. With `NOSYSBASHRC=1` neither held them, and doctor's leak check passed with no exemption.

## Related

- #281, #259, #280
- [Driving a plugin flow that sends a token to a service's real host](drive-a-token-flow-to-a-real-host-behind-a-tls-proxy.md)
