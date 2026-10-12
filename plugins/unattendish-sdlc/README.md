# Unattendish

Wakes the manager thread of an Unattendish fleet in [bb](https://getbb.app) when the tracker or forge the fleet waits on changes. A manager running the run-fleet skill moves only when a builder finishes, fails or asks, or when the operator writes to it; this plugin is the missing watcher, so an answer written on an issue, a review on a pull request or a spec marked ready reaches the manager without the operator telling it. It is the bb companion to the unattendish-sdlc skills and does nothing without them.

- **Poll the services**, GitHub, GitLab (gitlab.com and self-managed), Linear and Jira Cloud, on an interval, 2 minutes unless a fleet sets its own and never under 30 seconds. It works with `bb connect` off.
- **Read only what the fleet waits on**: the items the manager's manifest names, plus the operator's items gaining or losing the spec or ready label. Everything else is recorded as out of scope.
- **Drop the fleet's own actions** as echoes, by the marker, labels and bot accounts the manager registered, and send everything else that changed as one wake per poll, queued behind a running turn.
- **Keep a ledger** for 30 days of every change seen and what was done with it: `bb unattendish fleet ledger`.

A wake says what changed and never what anyone wrote: no comment or review body, title or display name. A change is sent twice before it is lost, because a cursor advances only once bb accepted the wake. Every request is a read, and a token goes only to the host of the prefix you chose it for. You enter credentials in the plugin's settings, a pasted token or your `gh` or `glab` login, and no command takes a token. `bb unattendish fleet status` says why a fleet is not watched. Uninstalling keeps its `data.db`, with every registration and the ledger, and deletes the credentials.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin unattendish-sdlc
```

- [First run](../../docs/tutorials/unattendish-first-run.md)
- [Set the credentials](../../docs/how-to/unattendish-set-credentials.md)
- [How Unattendish wakes a manager](../../docs/explanation/unattendish-polling.md): the poll, the watched set, echoes, cursors and credentials
- [`bb unattendish fleet`](../../docs/reference/unattendish-cli.md) and the wake
- [Settings and what it stores](../../docs/reference/unattendish-settings.md)
- [The Fleet contract, version 1](../../docs/reference/unattendish-fleet-contract.md): register, the manifest, the wake and dashboard messages
- [Install, update or remove a plugin](../../docs/how-to/install-plugins.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
