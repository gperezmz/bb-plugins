# Unattendish: settings and what it stores

Set these under Settings → Installed plugins → Unattendish, or with `bb plugin config unattendish-sdlc set <key> <value>`. A change applies at once, without a reload. Source: [`src/fleet/adapters/settings.ts`](../../plugins/unattendish-sdlc/src/fleet/adapters/settings.ts), [`src/fleet/adapters/credentials.ts`](../../plugins/unattendish-sdlc/src/fleet/adapters/credentials.ts), [`src/fleet/domain/identity.ts`](../../plugins/unattendish-sdlc/src/fleet/domain/identity.ts), [`src/fleet/adapters/store.ts`](../../plugins/unattendish-sdlc/src/fleet/adapters/store.ts). To choose a Credential for a fleet, see [set the credentials](../how-to/unattendish-set-credentials.md).

| Key | Label | Default | Meaning |
|---|---|---|---|
| `credentials` | Credentials | `[]` | A JSON list of entries, each saying how the plugin signs in to the services under one prefix. Multi-line |
| `tokens` | Tokens | not set | A JSON object from prefix to a pasted token; secret |

`bb plugin config unattendish-sdlc` lists `tokens` as secret and does not print its value. Put a token in the settings page, not in a command: a value on a command line stays in your shell history and, run from an agent thread, in that thread's transcript. No `bb unattendish` command takes a token.

Both settings are checked when saved: an entry that cannot be used is refused with a sentence naming it and why, and a sentence never quotes a token. Settings are checked again when the plugin loads, and the plugin's log gets one `settings:` warning for each fault. An entry with a fault is not used.

## Credentials

A Credential is one entry of `credentials`, and for a pasted token its matching key in `tokens`. A fleet uses the entry with the longest prefix that matches its repository, and separately the one that matches its tracker. If no entry matches, nothing is used: the fleet registers, and [shows not watched](../how-to/unattendish-set-credentials.md#read-why-a-fleet-is-not-watched), naming the prefix that is missing.

```json
[
  {"prefix": "github.com/org", "auth": "token"},
  {"prefix": "gitlab.example.com", "auth": "glab", "service": "gitlab"},
  {"prefix": "linear:ENG", "auth": "token"}
]
```

### An entry

Every key outside this table is refused.

| Key | Required | Meaning |
|---|---|---|
| `prefix` | yes | What the entry applies to; see [prefixes](#prefixes) |
| `auth` | yes | `token`, a token pasted under `tokens` for the same prefix; `gh`, use my `gh` login; or `glab`, use my `glab` login. The choice is made for each prefix and never falls back to another |
| `service` | for a host other than `github.com` and `gitlab.com` | `github`, `gitlab`, `linear` or `jira`. A `linear:` prefix is Linear and a `jira:` prefix is Jira; a repository prefix is `github` or `gitlab` |
| `baseUrl` | no | The API root the token is sent to; see [base URLs](#base-urls) |

`gh` needs `service` `github` and `glab` needs `gitlab`. Two entries may not spell one prefix, case aside: the later is refused. An entry that is refused still stops a fleet falling back to a shorter prefix: the fleet shows no credential.

### Prefixes

| Prefix | Applies to |
|---|---|
| `github.com` | Every repository on the host |
| `github.com/org` | Every repository under an owner or a group path |
| `github.com/org/repo` | One repository |
| `linear:` | Every Linear team |
| `linear:ENG` | One Linear team, by its key |
| `jira:example.atlassian.net` | Every project of a Jira Cloud site |
| `jira:example.atlassian.net/PROJ` | One Jira project, by its key |

A prefix matches only a whole host and whole path segments, without regard to case: `github.com/or` does not match `github.com/org/repo`, and `gitlab.com` does not match `gitlab.com.evil.net/x`. Of the entries that match, the one with the most segments wins; a Linear team or a Jira project beats a bare `linear:` or a site. A fleet's forge is matched against its repository, and its tracker against `forge-issues` as the repository, or against the Linear team or Jira project it names.

### Base URLs

The API root each service is read from, unless `baseUrl` says otherwise:

| Service | Default base URL |
|---|---|
| `github` on `github.com` | `https://api.github.com` |
| `github` on another host (GitHub Enterprise Server) | `https://{host}/api/v3` |
| `gitlab` | `https://{host}/api/v4` |
| `linear` | `https://api.linear.app/graphql` |
| `jira` | `https://{site}` |

A token is sent only to its credential's base URL, so `baseUrl` is only for a service whose API root differs, and the plugin permits it nowhere else. It is refused unless it is `https` on the prefix's own host for a repository prefix (`api.github.com` is also allowed for `github.com`, and no other `api.` host is), on `api.linear.app` for Linear, or on the site for Jira, and it may not carry a user name or password. `127.0.0.1`, `localhost` and `[::1]` are also allowed, with `http` or `https`, so a fake service can stand in for a test. An item is read only where it lies under the fleet's repository or tracker, and any other Ref or Link is never requested.

### Tokens

`tokens` is a JSON object from a prefix to the token pasted for it, such as `{"github.com/org": "…"}`. A token is used only for the entry whose `auth` is `token` and whose prefix is the same, case aside. A token that is empty or holds whitespace is refused, and so is a prefix given twice. A Jira token is `email:api-token`. Jira's scoped tokens call another host, `api.atlassian.com`, which a Jira credential's base URL may not name, so create a Jira token without scopes.

A `gh` or `glab` login is asked for its token on the bb server, as the user bb runs as, for the prefix's host: `gh auth token --hostname {host}`, or `glab auth status --hostname {host} --show-token`. The command runs without a shell and gets 10 seconds. The variables `gh` and `glab` read before their own login (`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN` and `OAUTH_TOKEN`) are removed from its environment, so the login you chose is the one used. The token is kept in memory for 5 minutes. A login is the same account the fleet's agents use, so its reads share their rate limit; `bb unattendish fleet status` says so for each fleet.

## The polling interval

Each fleet is polled every 2 minutes unless its own interval is set. The shortest is 30 seconds. Set it for one fleet with [`bb unattendish fleet interval`](unattendish-cli.md#bb-unattendish-fleet-interval); there is no global setting. The plugin checks which fleets are due every 5 seconds, so a poll starts up to 5 seconds after its interval ends.

## What it stores

| Where | What | For how long |
|---|---|---|
| `<data dir>/plugins/unattendish-sdlc/data.db` (SQLite) | Each fleet's registration, its cursors and the state of its last poll | Until [unregistered](unattendish-cli.md#bb-unattendish-fleet-unregister) |
| The same file | The ledger: changes seen and what was done with them, wakes, polls and failed reads | 30 days, also after the fleet is unregistered |
| The same file | The ledger: every change seen, each wake with its queued and dispatched times, each poll's requests, and each failed read | 30 days; the plugin deletes older rows hourly |
| The plugin's settings and secrets | `credentials` and `tokens` | Until uninstalled |

A token is stored only in `tokens`. It is in no wake, no ledger entry, no log line and no error message, and the registration holds the marker, the labels and the echo actors but no token. A change holds no text written on the service.

`bb plugin uninstall` deletes the settings, so the credentials and tokens go. `data.db` stays, with every registration, cursor and ledger row; installing the plugin again polls the registered fleets again, and each shows not watched until you set its credentials. To start from nothing, delete `data.db` while the plugin is uninstalled.

## What it sends off the server

Reads, and only reads, to the services the credentials name: a GET, or a GraphQL query with no mutation. Nothing is sent to a service that no credential matches, and a token goes only to its credential's base URL. The plugin sends the manager's thread one message per poll, the [wake](unattendish-cli.md#the-wake).
