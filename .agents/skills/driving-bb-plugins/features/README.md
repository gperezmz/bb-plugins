# bb-plugins driving map

The maintained source for verifying the user-facing behaviour of the plugins
in `plugins/`, each driven inside a throwaway bb. Read this index before
driving, then follow the feature file as the recipe. A feature is one
plugin's user-facing surface; each plugin installs and runs on its own, so a
drive starts only the plugins its feature file names.

## Baseline preconditions

- `drive-bb-plugins` means `.agents/skills/driving-bb-plugins/drive-bb-plugins`,
  run from the repository root, and every command after `start` carries
  `--run <run>`, the name `start` printed; the recipes leave it out.
- `chromium` is on `PATH` or `CHROMIUM_PATH` names one.
- A run is started with `drive-bb-plugins start <plugin>...`, naming the
  plugins in the feature file's `Preconditions:`, and
  `drive-bb-plugins doctor --run <run>` exits 0 on it.
- A fresh run has no threads, every plugin at its install defaults, and bb's
  navigation and thread list on `__automatic__`, which takes the first
  installed plugin offering one. A run started with `--snapshot` has the
  snapshot's threads and settings instead.

## Driving conventions

- Every recipe starts from a fresh run unless its preconditions say
  otherwise; a recipe that changes a setting other features read resets it
  before the next feature, or the next feature starts its own run.
- Locate elements by the role and accessible name the feature file gives.
  Where two groups share a name (`Medium` in UI Tweaks), scope to the group.
- Take commands literally: quoted names, JSON inputs and flags stay as
  written. A JSON input goes in a file passed with `--input-file`.
- UI actions go through the plugin's verbs,
  `drive-bb-plugins <plugin> <verb>`, CLI actions through
  `drive-bb-plugins bb`, threads through `drive-bb-plugins seed`, or
  `drive-bb-plugins spawn` for a thread working, failed or running a
  background command in a tree the recipe builds.
- A drive that needs a UI step no verb covers adds the verb to
  `verbs/<plugin>.mjs` (starting the file for a plugin that has none), runs
  it, and names it in the feature file's recipe, in the same pull request as
  the change it verified.
- Wait on the state an action should reach (`waitFor`), never a fixed sleep,
  except where a gotcha names a delay the plugin itself imposes.

## Evidence and skip reporting

- Each UI action has a `capture` before and after it; the label names the
  feature, the sub-feature and the entry point, as
  `<feature>.<sub-feature>/<entry>`.
- Each UI mutation is read back through the CLI or RPC the feature file
  names; each CLI mutation is read back in the UI.
- A drive reports each sub-feature as verified, map false (with what the app
  did instead), or blocked (with the command tried and the precondition that
  did not hold).
- An entry point that was skipped is never reported as verified through a
  different one.

## Feature entry contract

Each feature file opens with an H1 title and one paragraph describing the
user-visible behaviour. It then uses exactly these four H2 sections, in
order:

1. `Sub-features`: short IDs, one line of behaviour each.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with drive-bb-plugins`: opens with `Preconditions:` naming the
   plugins to `start` and any other state, then labelled bullets pairing each
   user action with an exact command and an observable result.
4. `Gotchas`: traps that waste or invalidate a drive.

Implementation detail stays out of the map. Name only user paths, stable
handles, required state, commands, and observable evidence.

## Features

- [UI Tweaks](./ui-tweaks.md): text size and transcript width, from the
  settings section and from RPC, applied live to the New-thread screen.
- [Thread Glance](./thread-glance.md): the sidebar thread list, its settings
  popover and `prefs` CLI, child-thread chips, need you, the settled fold,
  group headers' New thread, Rename and Remove, second windows and remounts,
  each a verb.
- [Thread Usage](./thread-usage.md): the header coin, the Usage tab, the
  Thread usage page and the `thread-usage` CLI over a parent and child
  thread.
- [Cache Keeper](./cache-keeper.md): the composer chip, compact when idle on
  the drive clock, the banner and the Cache Keeper page.

Not yet mapped: Team Onboarding (`plugins/team-onboarding`) and
OpenAI-compatible inference (`plugins/openai-inference`). Each has a
`test/npm-install-fixture.sh` or tests that show what a drive would reach.
