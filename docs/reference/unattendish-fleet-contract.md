# Unattendish Fleet contract, version 1

The contract between the Unattendish plugin and run-fleet, the skill in the unattendish-sdlc repository that runs a fleet: the register call and the manifest. This page is its one authority: run-fleet points here by contract version and does not restate it. Changing any part of it, an argument, an outcome or a column, is a new contract version, which a caller passes to `register` as `--contract`; the plugin answers a version it does not speak with `unsupported`. Version 1 is the only one. What the plugin sends a manager is a plain message in the operator's voice, not part of the contract: [the wake](unattendish-cli.md#the-wake) shows its text. Source: [`registration.ts`](../../plugins/unattendish-sdlc/src/fleet/domain/registration.ts), [`manifest.ts`](../../plugins/unattendish-sdlc/src/fleet/domain/manifest.ts).

**Register.** The manager runs this from its own thread on every `/run-fleet` invocation:

```text
bb unattendish fleet register --contract 1
  --repo <host>/<path>                    # as the manifest's first line spells it
  --tracker <forge-issues | linear:<team key> | jira:<site>/<project key>>
  --manifest <absolute path of fleet/manifest.md>  # may not exist yet
  --operator <login>                      # the operator's login on the tracker: whose partition the fleet builds
  --label-spec <l> --label-ready <l> --label-in-progress <l> --label-needs-input <l>
  --marker <text that ends every fleet comment>
  [--echo-actor <login>]...               # a separate bot account the fleet's agents act as; never the operator
  --json
```

The manifest path may name a file not written yet: until it can be read, the fleet's watched set is its labelled items alone, and `notWatched` holds a `manifest-missing` reason. `--json` comes after the command. Every outcome below exits 0 and prints one JSON object on stdout, with `outcome` at its top level. A non-zero exit prints bb's error envelope on stdout instead (`{"ok": false, "error": {"code": …}}`): `unknown_command` means the plugin is not installed, and any other code means registering failed, which the skill treats as running without wakes. A tracker none of `--tracker`'s forms names is not registered: the skill runs that fleet without wakes. The `outcome` is one of:

| `outcome` | When | Also carries |
| --- | --- | --- |
| `registered` | No thread holds the repository, or this thread already does | `watched` (true or false) and `notWatched`, a list of reasons, empty while watched. Each reason is `{code, text}`: `code` is one of `manifest-missing`, `manifest-unreadable`, `no-credential` or `credential-refused`, and `text` says it for a person, naming the prefix or path |
| `taken-over` | The thread holding the repository is archived | `previousManager`, the old manager's thread id; `previousManifest`, its manifest path; and `watched` and `notWatched` as for `registered` |
| `refused` | Another unarchived thread holds the repository | `holder`, that thread's id |
| `unsupported` | The contract version is not one this plugin speaks | `supported`, the versions it speaks |
| `invalid` | An argument breaks the contract, such as an `--echo-actor` equal to `--operator` | `reason`, naming the argument |

Without the plugin, `bb unattendish` does not exist, and run-fleet carries on without wakes.

**The manifest, as the plugin reads it.** The first line is `# Fleet: <host>/<path>`. These sections are read by their columns; every other section is shown as written:

| Section | Columns |
| --- | --- |
| Inbox | Ref, What, Waits for, Since, Link |
| In flight | Ref, Work, Stage, Since, Builder, Link |
| Blocked | Ref, Blocked on, Link |
| Landed | Ref, Spec, Merged, Link |

- Ref: the tracker's reference (`#163`, `ENG-212`, `PROJ-12`), or `—` for work with none.
- Waits for: exactly one of `answer` (a parked question), `grant` (a grant to merge or to do something that cannot be undone), `ready` (the ready label on a spec) or `other` (anything else waiting on the operator).
- Since: when the row took its current Waits for (Inbox) or Stage (In flight). Merged: when the pull request merged. Both are ISO 8601 times with an offset, `Z` counting as one.
- Stage: exactly one of `building`, `asking`, `waiting on you`, `under review`, `at the bar`, `round open`, `brainstorming`.
- Builder: a bb thread id, or `—`.
- Blocked on: references separated by commas.
- Link: the row's pull request where one is open, or in Landed the one that merged, else the item's URL on the tracker or the forge. For a row whose Ref is `—`: `this thread, message <n>, <ISO 8601 time with an offset>`. For a row carried over from a previous manager whose Ref is `—`: `thread <its id>, message <n>, <ISO 8601 time with an offset>`, naming that manager's message. An Inbox row re-asking a carried-over grant takes the same form, naming the message that gave it, with the grant's own words as the row's What.
- A section with no rows is one line of prose and holds no table.
