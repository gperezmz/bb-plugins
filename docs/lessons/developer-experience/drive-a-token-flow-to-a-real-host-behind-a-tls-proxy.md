---
title: Driving a plugin flow that sends a token to a service's real host
date: 2026-10-12
category: developer-experience
module: plugins/unattendish-sdlc
problem_type: developer_experience
component: Connect popup
severity: medium
applies_when:
  - "verifying a Connect popup path that adds a new login, a gh or glab login, a Linear key or a Jira account"
  - "a drive comes back blocked because the plugin would reach api.github.com, a GitLab host, api.linear.app or an atlassian.net site"
  - "driving any plugin code that sends a token to a fixed public host with no address to point at a fake"
tags: [driving, fake-services, tls-proxy, certificate-authority, connect, accounts, verification]
status: stale
stale_reason: "The Connect popup and the harness it was driven through belong to the deleted unattendish-sdlc plugin. The TLS-proxy method may still hold for another plugin that sends a token to a fixed host, which is not settled here."
stale_date: 2026-10-25
---

# Driving a plugin flow that sends a token to a service's real host

## Context

Unattendish's Connect popup sends a new login's token, and a `gh` or `glab` login's, to the service's own API host: an account's API address can be set only through the plugin's RPC `connect`, and the popup never sets one (`plugins/unattendish-sdlc/src/fleet/application/accounts.ts:309` reads it from the call; the popup's call never carries one, only a direct caller of the RPC does). The drive harness's fakes (`plugins/unattendish-sdlc/harness/fake-services.ts`) answer on loopback, so accounts the harness adds over RPC reach them, but nothing the popup adds does. A verification drive of #253 that stopped at that point came back blocked on every "new login" path.

## Guidance

Run the throwaway bb's server behind a local HTTPS proxy that terminates TLS for exactly the hosts the fakes stand in for, forwards those to the fakes, and refuses every other host, so nothing real is reached:

- Make a certificate authority and one leaf certificate whose names cover the hosts (`api.github.com` and `github.com`, the GitLab host, `api.linear.app`, the Jira site).
- Start the proxy: on `CONNECT` to a mapped host, answer `200`, wrap the socket in a server-side TLS socket with the leaf, and forward each request to the fake on `127.0.0.1`; answer `403` to any other `CONNECT`. Log every request with the host and whether it carried an `Authorization` header, never the header's value.
- Start the run's bb server with `HTTPS_PROXY` set to the proxy, `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses it, and `NODE_EXTRA_CA_CERTS` set to the authority's certificate (*per the #253 drive's own note; the values were not kept*). The proxy's log of the fakes answering shows the three worked together.
- Let `registry.npmjs.org` bypass the proxy: through it, the plugin's toolchain download is refused with a 403 and `start` stops with "could not install".
- Put fake `gh` and `glab` scripts first on the server's `PATH`, answering `auth status --hostname <h> --json hosts` and `auth token --hostname <h> --user <login>` (glab: `auth status --show-token`) from a state file, so a `gh` login switch can be scripted. The fake `gh` exits non-zero on `auth token` with no `--user`: a run's doctor and `start.sh` run that bare form and fail the run when it finds a token (`plugins/cache-keeper/harness/run-env.sh:139`; see [the caller-environment lesson](keep-the-caller-environment-out-of-a-drive-run.md)).
- Keep the browser on loopback too, so a Create token link opened in the drive does not reach the real site.

The proxy's log then shows every host the server reached through it and that each connection outside the map was refused, a route the plugin did not write; a client that ignores the proxy variable (the npm bypass, the `gh` and `glab` CLIs) is not in it, and the browser is covered by its own loopback guard.

## Why This Matters

Without it, every path that adds an account through the popup, AC2's and AC7's new login, AC8's first account becoming the default and AC12's Linear and Jira accounts among them, can only be reached over RPC, which is the tested rung, not driven, and the popup's own wiring of those paths goes unchecked.

## When to Apply

Before driving any path the plugin sends to a fixed public host: plan the proxy first rather than discovering the block after the drive. Accounts added over RPC with a loopback `apiUrl` stay the cheaper route for every path that does not need the popup to add the account.

## Examples

The #253 drive's scaffolding (proxy, certificate authority, fake `gh`/`glab`, a wrapper that sets the fakes' state) was written under `.drives/v253a-tools/`, which git ignores, so it is gone once that directory is cleaned: the steps above are what it did.

## Related

- #253
