# Cache Keeper

Keeps idle Claude Code threads cheap to come back to, and only where it is
switched on: sends nothing on a fresh install. With Compact when idle on, it
sends `/compact` to an idle thread just before its prompt cache goes cold,
when the thread stopped at or above its compaction line. With Keep warm
while waiting on, it keeps a tree warm while it waits on background work. A
composer chip and banner show what it plans for the open thread, sidebar
rows get a timer or flame, and a Cache Keeper page lists what it has on and
what it sent.

## Sub-features

- `chip`: the composer chip, `Cache Keeper: <sentence>`, and its popover.
- `compact`: Compact when idle, the compaction line, and the `/compact` at
  the deadline.
- `banner`: `Compacting in Nm, before the cache goes cold`, with `Skip` and
  `Compact now`.
- `keep-warm`: Keep warm while waiting, per thread tree.
- `page`: the Cache Keeper page.
- `cli`: `bb cache-keeper on|off|compact-now|keep-warm|status`.

## How to get to it (user POV)

- A Claude Code thread's composer: `button` named `/^Cache Keeper:/`. Its
  popover holds `switch "Compact when idle"`,
  `switch "Keep warm while waiting"` and, once the first turn has ended, `slider "Compaction line"`
  with a button on its handle named for the size (`≥ 500k`); clicking it
  turns it into `textbox "Compaction line size"`.
- Above the composer while a compaction is due: `status` with
  `Compacting in Nm, before the cache goes cold`, `button "Skip"`, `button "Compact now"`.
- `navigation "Primary navigation"` → `Cache Keeper`: `heading "Cache Keeper"` level 1, and
  sections `Compact when idle`, `Waiting on background work`, `Recent`,
  `Last 30 days`.
- Settings → Installed plugins → Cache Keeper, at
  `/settings/plugins/cache-keeper`.
- CLI: `bb cache-keeper on [<thread>] [--above <size>]`, `off`,
  `compact-now`, `keep-warm on|off`, `status [<thread>] [--json]`; on a run,
  also `drive advance <90s|4m|1h>` and `drive now`.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start cache-keeper`, then a settings file
holding `{"keepWarm":"switched","checkIns":false,"fetchPrices":false}` passed
to `drive-bb-plugins bb cache-keeper/setup -- plugin rpc call cache-keeper setSettings --input-file <file> --json`.

- **A thread** (`cache-keeper.compact/spawn`):
  `T=$(drive-bb-plugins spawn cache-keeper.compact/spawn ck hello)`, then
  `drive-bb-plugins bb cache-keeper.compact/cli -- cache-keeper drive now`.
- **Switch on from the chip** (`cache-keeper.chip/composer`): a `ui` script
  opens `$T` from the sidebar, clicks `button` named `/^Cache Keeper:/`,
  captures, clicks `switch "Compact when idle"`, waits for it
  `aria-checked="true"`, and captures;
  `drive-bb-plugins bb cache-keeper.chip/cli -- cache-keeper status "$T" --json`
  has `.compactOn` true.
- **Due** (`cache-keeper.compact/cli`): `cache-keeper on "$T" --above 100k`
  (the fake API reports 800k tokens) and `drive now`: `status "$T" --json`
  has `.compactionDue` true at once and `.deadline` 4 minutes after the last
  request, and a `ui` script on `$T` finds the banner `status`
  `Compacting in 4m, before the cache goes cold` and the chip's text `4m`.
- **Skip and Undo** (`cache-keeper.banner/composer`): the banner's `Skip`
  turns it into `Skipped until this thread next runs` with `Undo`, and
  `status` has `.compactSkipped` true and `.compactionDue` false; `Undo`
  brings the banner back.
- **Sent** (`cache-keeper.compact/cli`): take `.now` from `drive now` and
  `.deadline` from `status --json`, then `drive advance <deadline − now + 2>s`
  and `drive now`: `status` reads `compacted …`, and
  `plugin rpc call cache-keeper overview --json` has a `recent` entry with
  `kind` `compaction` and `record.contextBefore` 800003; the page draws it as
  `Compacted 800k → …`.
- **Compact now** (`cache-keeper.cli/compact-now`):
  `cache-keeper compact-now "$T"` on an idle thread prints `compacting`.
- **Keep warm** (`cache-keeper.keep-warm/cli`):
  `W=$(drive-bb-plugins spawn cache-keeper.keep-warm/spawn kw hello --background)`,
  `drive now`, then `cache-keeper keep-warm on "$W"` prints the tree top, and
  `status "$W" --json` has `.keptWarm`, `.warmPlanned` and `.waiting` true; a
  `ui` script on `$W` finds the popover's `switch "Keep warm while waiting"`
  checked. `drive-bb-plugins release "$W"` after.
- **Page** (`cache-keeper.page/nav`): a `ui` script clicks `Cache Keeper` in
  `navigation "Primary navigation"` (or its `More` menu) and finds
  `$T`'s title under `Compact when idle`, and h2s
  `Waiting on background work`, `Recent` and `Last 30 days`.
- **Settings** (`cache-keeper.settings/page`): a `ui` script at
  `url + "settings/plugins/cache-keeper"` finds
  `combobox "Keep caches warm while waiting"` and the sections `Waiting threads`, `Stalled tasks`,
  `Prices` and `Agent tools`.

The plugin's own regression drives, `plugins/cache-keeper/harness/drives/`,
run against its own harness, not this run; its README says how.

## Gotchas

- The drive clock only moves forward, and restarts from wall time when the
  plugin reloads, a reinstall included.
- The chip shows on every Claude Code thread from its creation; until the
  first turn ends it has no compaction line and the popover no slider.
- A compaction is sent only in the minute after its deadline: an advance
  that overshoots that minute (`3m` then `2m` after the 4-minute deadline)
  sends nothing, and the banner goes. Advance to the deadline.
- The chip and banner refresh on the plugin's change signal, and sidebar row
  glyphs every 20 s: run `drive now` before reading the UI after an advance.
- `compact-now` refuses (`not_ready`) unless the thread is idle with nothing
  pending.
- On a fresh install every switch is off, the agent tool included; a
  reinstall resets them again.
- Below 768 px wide the chip's popover opens as a dialog.
