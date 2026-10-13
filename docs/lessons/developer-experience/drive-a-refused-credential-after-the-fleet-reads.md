---
title: Driving a credential the service refuses, rather than one recorded as unable to read
date: 2026-10-13
category: developer-experience
module: plugins/unattendish-sdlc
problem_type: developer_experience
component: drive harness
severity: medium
applies_when:
  - "a drive needs a fleet whose credential the service refuses: `refused by the service`, a not-watched fleet, or the needs-an-account toast"
  - "a drive makes a fake service answer 401 to test an expired, revoked or wrong token"
  - "a drive shows `cannot read` or Connect… where the requirement expects a refusal"
tags: [driving, fake-services, refused, credential-refused, verification, harness]
---

# Driving a credential the service refuses, rather than one recorded as unable to read

## Context

Unattendish says a credential is behind by two routes that share the `credential-refused` code. A poll that gets a 401 records an outage, which reads `… was refused by the service` (`plugins/unattendish-sdlc/src/fleet/application/poll.ts:181`, `plugins/unattendish-sdlc/src/fleet/domain/registration.ts:152`). The access check that runs when a fleet is registered or a token connected maps 401 as well as 403 to `forbidden` (`plugins/unattendish-sdlc/src/fleet/adapters/probe.ts:38`), and stores it as an access problem: `… cannot read …`, with Connect…, kept until a read succeeds (`plugins/unattendish-sdlc/src/fleet/application/accounts.ts:544`, `plugins/unattendish-sdlc/src/fleet/application/poll.ts:268`). A verification drive of #261 that put the 401 in place before registering got the second route and saw `Connect… +1` where it wanted the refusal.

## Guidance

Order the drive so the fleet reads first:

1. Connect the token and register the fleet while the fake still answers it.
2. Let one poll succeed.
3. Make the fake answer 401 on `/repos/<owner>/…`, then let polls run until `bb unattendish fleet status` shows the fleet not watched with `refused by the service`.

A 401 already answering at step 1 tests the access-problem route instead. For a `gh` or `glab` login, which the Connect popup never gives an API address, the fake is reached only through the TLS proxy of [Driving a plugin flow that sends a token to a service's real host](drive-a-token-flow-to-a-real-host-behind-a-tls-proxy.md), with a fake `gh` that answers `auth token` only with `--user`, as [Keeping the caller's environment out of a drive run, and proving it by name](keep-the-caller-environment-out-of-a-drive-run.md) requires.

## Why This Matters

The two routes look alike in the drive's setup and differ in what the fleet says: `cannot read …` against `was refused by the service`, and the access problem stays until a read succeeds, so it can stand beside another flag as `+1`. A drive on the wrong route reports a verdict about a path the requirement never named.

## When to Apply

Whenever a requirement speaks of the service refusing a credential, and whenever a drive sees `cannot read` where it expected `refused`.

## Examples

In the #261 drive, a fleet registered while the fake already answered 401 showed `GitHub · operator for <owner> cannot read <repo>: …` with Connect…, an access problem, and for an expired token `Connect… +1`, that problem beside the expired one, until the build let an expired token stand in for both. The same token refused only after the fleet had read showed `refused by the service` in `fleet status`, which is the route the requirement named.

## Related

- [Driving a plugin flow that sends a token to a service's real host](drive-a-token-flow-to-a-real-host-behind-a-tls-proxy.md)
- [Keeping the caller's environment out of a drive run, and proving it by name](keep-the-caller-environment-out-of-a-drive-run.md)
- #261
