# Unattendish

Wakes the manager thread of an Unattendish fleet in [bb](https://getbb.app) when the tracker or forge the fleet waits on changes. A manager running the run-fleet skill moves only when a builder finishes, fails or asks, or when the operator writes to it; this plugin is the missing watcher, so an answer written on an issue, a review on a pull request or a spec marked ready reaches the manager without the operator telling it. It is the bb companion to the unattendish-sdlc skills and does nothing without them.

- **Poll the services**, GitHub, GitLab (gitlab.com and self-managed), Linear and Jira Cloud, on an interval, 2 minutes unless a fleet sets its own and never under 30 seconds. It works with `bb connect` off.
- **Read only what the fleet waits on**: the items the manager's manifest names, plus the operator's items gaining or losing the spec or ready label. Everything else is recorded as out of scope.
- **Drop the fleet's own actions** as echoes, by the marker, labels and bot accounts the manager registered, and send everything else that changed as one wake per poll, queued behind a running turn.
- **Keep a ledger** for 30 days of every change seen and what was done with it: `bb unattendish fleet ledger`.
- **Read as an account you choose**: a fleet is read as an account, one login on one host or service, with a read-only token that **Connect…** helps you create on the service's own page, pre-filled, and checks before it stores it. Settings lists the accounts and manages them.
- **Show the operator their fleets**: a Fleets page in bb's navigation with a fleet board, one line per fleet with its manager, counts, spend and the fix for what is wrong, over a queue of everything that waits on you across fleets; a toast in every window when a new row appears; a Fleet chip in each manager's header with what waits on you and a dot for a problem or a warning; and a Fleet tab in its panel, the fleet's header over the manifest's rows, its notes, what is watched and how, and the ledger. A fleet no account reads gets a toast, a line on the fleet board and a strip on its Fleet tab, each with **Connect…**. Answer…, Grant… and Build it send the manager the message; the plugin writes nothing to a tracker.

A wake says what changed and never what anyone wrote: no comment or review body, title or display name. A change may be sent twice but is never lost, because a cursor advances only once bb accepted the wake, and a failed read never lets a cursor skip a change. Every request is a read, and a token goes only to its own account's host. The plugin reads no CI, so it never wakes a manager with `checks passed` or `checks failed`. You connect a fleet through **Connect…** on its card, on the fleet board or on the toast that says what it needs: choose which account reads the owner, then create a read-only token on GitHub or GitLab, paste one, or use your `gh` or `glab` login, and the plugin checks whose it is and that it can read the fleet before it stores it. Accounts are managed in Settings. A `gh` or `glab` login and a pasted classic GitHub token can write, and are labelled **can write**; no command takes a token. A fleet whose service refuses, forbids or does not answer every read, finds nothing under the fleet's repository or tracker, answers only from outside it, or keeps failing to list what changed, is not watched, and the manager is told once per source; `bb unattendish fleet status` says why. `bb plugin remove` keeps the plugin's `data.db`, with every registration, the ledger and the stored tokens, so **it leaves the tokens on disk**: remove every account in Settings before you uninstall to delete them. After a remove or a renew the old token still works at the service until it expires or you revoke it there.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin unattendish-sdlc
```

- [First run](../../docs/tutorials/unattendish-first-run.md)
- [Connect a fleet to an account](../../docs/how-to/unattendish-connect-a-fleet.md): Connect…, read-only tokens and managing accounts in Settings
- [Answer, grant or build from the dashboard](../../docs/how-to/unattendish-answer-from-the-dashboard.md)
- [The Fleets page, the Fleet chip and the Fleet tab](../../docs/reference/unattendish-dashboard.md)
- [How Unattendish wakes a manager](../../docs/explanation/unattendish-polling.md): the poll, the watched set, echoes, cursors, accounts and credentials
- [`bb unattendish fleet`](../../docs/reference/unattendish-cli.md) and the wake
- [Accounts, settings and what it stores](../../docs/reference/unattendish-settings.md)
- [The Fleet contract, version 1](../../docs/reference/unattendish-fleet-contract.md): the register call and the manifest
- [Install, update or remove a plugin](../../docs/how-to/install-plugins.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
