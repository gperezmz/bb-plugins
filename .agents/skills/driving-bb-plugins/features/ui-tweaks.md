# UI Tweaks

Two appearance settings bb lacks, under Settings → Installed plugins → UI
Tweaks: Text size (Small, Medium, Large) and Transcript width (Narrow,
Medium, Wide). Medium is bb's own look, and a fresh install reads Medium for
both. Small and Large make transcript and composer text 12 or 15 px where bb
draws 13; Narrow and Wide make the transcript and composer columns 640 or
960 px where bb draws 760. A change reaches every open window with no reload,
on thread views and the New-thread screen, and never on a phone.

## Sub-features

- `text-size`: the Text size radiogroup, and the text it resizes.
- `width`: the Transcript width radiogroup, and the columns it resizes.
- `keyboard`: the arrow keys move a radiogroup's choice, wrapping at its
  ends, and save it.
- `thread-view`: the transcript and composer columns of an open thread.
- `live`: a change made from RPC shows in an open page without a reload.
- `strict`: `setTweaks` refuses a key or value outside the segments.
- `phone`: nothing applies on a touch phone at 767 px or narrower.

## How to get to it (user POV)

- Settings (`/settings`) → Installed plugins → UI Tweaks, at
  `/settings/plugins/ui-tweaks`: radiogroups `Text size` and
  `Transcript width`, each with radios named by their segment.
- The effect: the New-thread screen at `/` (composer
  `textbox "Ask anything."`) and any thread view.
- RPC: `bb plugin rpc call ui-tweaks getTweaks` and `setTweaks` with a
  partial
  `{"textSize": "small|medium|large", "width": "narrow|medium|wide"}`. There is no `bb ui-tweaks` command.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start ui-tweaks`. No thread is needed; the
New-thread screen carries both effects.

- **Read the default** (`ui-tweaks.text-size/rpc`):
  `drive-bb-plugins bb ui-tweaks.text-size/rpc -- plugin rpc call ui-tweaks getTweaks --json`
  prints `{"textSize": "medium", "width": "medium"}`.
- **Set both from Settings** (`ui-tweaks.text-size/settings`): a `ui` script
  that goes to `url + "settings/plugins/ui-tweaks"`, waits for
  `radiogroup "Text size"` → `radio "Medium"` checked, captures, clicks
  `radio "Large"` in `Text size` and `radio "Narrow"` in `Transcript width`,
  waits for each to be `checked: true`, and captures. No `alert` appears.
- **Read the stored value**: `getTweaks` as above prints
  `{"textSize": "large", "width": "narrow"}`.
- **See the effect** (`ui-tweaks.width/new-thread`): a `ui` script at `url`
  takes the New-thread column, the last `.max-w-\[760px\]` holding
  `#root-compose-prompt`, and waits with `page.waitForFunction` for its
  computed `maxWidth` to read `640px` (Narrow; `760px` at Medium, `960px`
  after Wide); `#root-compose-prompt`'s computed `fontSize` then reads
  `15px` (Large; `13px` at Medium, `12px` at Small).
- **Keyboard** (`ui-tweaks.keyboard/settings`): in the same script, focus
  `radio "Large"` in `Text size` and press ArrowRight: `radio "Small"` is
  checked, and `getTweaks` reads `"textSize": "small"`.
- **Thread view** (`ui-tweaks.width/thread`): with Large and Wide stored and
  a thread from `drive-bb-plugins spawn ui-tweaks.width/spawn "tweak thread" "reply ok"`,
  a `ui` script at `url + "projects/<project>/threads/<thread>"` waits for
  every `.max-w-\[760px\]` inside `[data-thread-window]:not([data-surface-tone])`
  (the transcript and composer columns) to compute `maxWidth` `960px`; back
  at Medium they read `760px` and `document.head` holds no tweak `<style>`.
- **Live from RPC** (`ui-tweaks.live/rpc`): with a page open on
  `settings/plugins/ui-tweaks`, write `{"width":"wide"}` to a file and run
  `drive-bb-plugins bb ui-tweaks.live/rpc -- plugin rpc call ui-tweaks setTweaks --input-file <file> --json`;
  the open page's `radio "Wide"` becomes checked without a reload. The `ui`
  script runs that command with `child_process.execFileSync` on
  `process.env.DBP_HARNESS` between its two captures.
- **Strict** (`ui-tweaks.strict/rpc`): `setTweaks` with `{"width":"huge"}`,
  or with a key it does not have (`{"colour":"red"}`), exits 1 with
  `HTTP 400: rpc input validation failed`, and `getTweaks` still prints the
  previous value.
- **Phone** (`ui-tweaks.phone/new-thread`): with Narrow stored, a `ui` script
  with `--mobile` waits 5 seconds on `url` and finds the New-thread column's
  `maxWidth` still `760px`, not `640px`.

## Gotchas

- The radios are disabled until the plugin's first read answers; wait for a
  checked radio before clicking.
- `Medium` names a radio in both groups: scope every radio to its
  radiogroup.
- Nothing visible changes on the Settings page itself; the effect is only on
  the New-thread screen and thread views.
- The tweak reaches a freshly loaded page a few seconds after load: a width
  or font read straight after `waitFor` still gives bb's own value. Wait for
  the value you expect; prove an absence by waiting 5 seconds, the grace the
  plugin itself gives a screen.
- On a phone bb draws the New-thread editor at 16 px on its own, so the
  font says nothing there; the column width does.
- A reinstall resets both to Medium; an update keeps them.
- The phone exclusion needs a coarse pointer as well as a narrow window: a
  narrow desktop viewport still applies the tweaks, so use `--mobile`.
- The width targets are bb's own classes in bb 0.44 (`.chat-prompt-box`,
  `.max-w-[760px]`); on another bb version a plugin that applies nothing
  logs a warning after 5 seconds, which `plugin-ui-tweaks.log` or
  `console.log` shows.
