---
title: GitHub PR Status's unavailable message does not tell a non-GitHub remote from a failed lookup
date: 2026-10-24
category: integration-issues
module: plugins/thread-glance
problem_type: integration_issue
component: auto-settle
severity: medium
symptoms:
  - "A rule matching gh's \"none of the git remotes configured for this repository point to a known GitHub host\" does not fire for a workspace whose remote is a plain owner/repo URL on gitlab.com or a self-hosted forge"
  - "GitHub PR Status answers a gitlab.com workspace with `unavailable` and \"GitHub returned no result for this pull request\""
  - "A workspace on an unreachable host answers \"gh api graphql failed: error connecting to <host>\" followed by \"check your internet connection\", the same as being offline"
tags: [github-pr-status, gh, pull-request, non-github-remote, unavailable, auto-settle, bb-0-47]
retire_when: "bb's bundled GitHub PR Status answers a workspace with no GitHub remote as `absent` or with its own outcome; check `bb plugin rpc inspect bb--github-pr-status pullRequests` and its dist/host.js on a new bb release"
---

# GitHub PR Status's unavailable message does not tell a non-GitHub remote from a failed lookup

## Problem

Issue #330 set out to let Thread Glance's quiet rule settle workspace threads
whose remote is not on GitHub, telling them from a failed lookup by matching the
message `gh` prints for such a remote inside GitHub PR Status's `unavailable`
row. The plugin bb 0.47.1 bundles passes that message on only where it can parse
none of the workspace's remotes as host, owner and repository: a path, a bare
alias, a URL with subgroup segments, an unsupported scheme. For the usual
owner/repo URL on gitlab.com or a self-hosted forge it answers with another
message, so the rule would have kept those threads for good.

## Symptoms

Running `gh pr view` by hand in a repository whose remote is on gitlab.com
prints "none of the git remotes configured for this repository point to a known
GitHub host", which is where the idea came from. The plugin's answer for the
same workspace carries a different message, or one that reads as being offline.

## What Didn't Work

Matching `gh`'s non-GitHub message, the issue's own decision. It holds only
when the plugin can parse none of the workspace's remotes as host, owner and
repository, and has no pull request address stored for the environment, since
only then does it run `gh pr view`.

## Solution

The operator's decision on #330: every `unavailable` row is a failed lookup,
kept and retried, whatever the remote, as the issue says upstream bb-sidebar
does, with one exception, a workspace that no longer exists. In
`plugins/thread-glance/shared/github-pr-status.ts`, `rowReader` reads an `unavailable` row as `failed`;
the one message matched there is `WORKSPACE_GONE_MESSAGE`, a workspace that no
longer exists.

## Why This Works

In the plugin's bundled host entry (bb-app's server/dist/builtin-plugins/github-pr-status/dist/host.js), any remote of the workspace that parses as host,
owner and repository (`parseGitRemoteRepository`) sends the lookup through GraphQL
(`runGraphQLRead`, which runs
`gh api graphql --hostname <remote host> --method POST --input <file>`), never through `gh pr view`. With gh 2.102, that call against gitlab.com
gets a GraphQL answer with errors, which the plugin reports as "GitHub returned
no result for this pull request". Against a host that cannot be reached it gets
"error connecting to <host>", the message `gh` gives for being offline. So the
plugin's message cannot separate "no GitHub here" from "could not ask", and
keeping both never settles a thread whose pull request could not be looked up.

## Prevention

Before building on what another plugin's `unavailable` message says, run the
command the plugin runs, read from its bundled host entry, against each kind
of input the rule must tell apart, rather than the command a user would run by
hand. Settling a non-GitHub workspace thread again needs a fact other than the
message, such as the environment's remote host, or a plugin outcome of its own.

## Related

- #330, the issue and its decision comment.
