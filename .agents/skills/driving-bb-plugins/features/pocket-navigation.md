# Pocket Navigation

On a phone, draws bb's sidebar navigation as a New thread line with search at
its end, above one row of icon buttons, one per visible entry in bb's order,
ending in a `…` button that lists the hidden entries and Customize sidebar.
Anywhere wider it draws bb's own navigation unchanged. It follows bb's
Customize sidebar order and visibility and never changes them.

## Sub-features

- `phone-row`: the New thread line and the icon row on a phone.
- `wide`: bb's own navigation, untouched, on a wider window.
- `overflow`: the `More sidebar navigation` menu, ending in `Customize
  sidebar`.
- `active`: the open entry marked `aria-current="page"`.

## How to get to it (user POV)

- The sidebar's navigation block on a phone-width window, once Pocket
  Navigation is the navigation: automatic on a bb with no other navigation
  plugin, or Settings → Appearance → Navigation → Pocket Navigation, or
  `bb settings ui set sidebar.navigationProvider pocket-navigation/pocket-navigation`.
- `navigation "Sidebar navigation"`, holding `button "New thread"`, icon
  buttons named by bb's entry labels (`Plugins`, `Automations`, …) and
  `button "More sidebar navigation"`.
- The overflow menu: `menuitem`s for hidden entries, then `menuitem
  "Customize sidebar"`.
- No CLI command, RPC method or settings section of its own.

## Driving it with drive-bb-plugins

Preconditions: `drive-bb-plugins start pocket-navigation`. Add `thread-usage`
or `cache-keeper` to the `start` for more entries in the row.

- **Chosen** (`pocket-navigation.phone-row/cli`):
  `drive-bb-plugins bb pocket-navigation.phone-row/cli -- settings ui set sidebar.navigationProvider pocket-navigation/pocket-navigation`,
  then `settings ui get sidebar.navigationProvider` prints
  `"pocket-navigation/pocket-navigation"`.
- **Phone row** (`pocket-navigation.phone-row/sidebar`): a `ui` script with
  `--mobile` opens the sidebar (`button "Toggle sidebar …"` where it is
  closed) and finds, inside `navigation "Sidebar navigation"`, `button "New
  thread"`, `button "Plugins"` and `button "More sidebar navigation"` in one
  row.
- **Overflow** (`pocket-navigation.overflow/sidebar`): the same script clicks
  `More sidebar navigation`, waits for the menu's `menuitem`s, and finds the
  last one is `Customize sidebar`.
- **Wide** (`pocket-navigation.wide/sidebar`): a `ui` script without
  `--mobile` finds bb's own rows (`button "Plugins"` beside `button "Plugins
  options"`), the navigation Pocket Navigation leaves alone.

## Gotchas

- Nothing changes above 767 px wide; the phone layout needs `--mobile`.
- On a phone the `…` menu opens as a bottom drawer titled `More` whose items
  arrive a frame later: wait for the `menuitem`s.
- The navigation choice is a server setting shared by every window; a fresh
  run starts on `__automatic__`.
- Entries such as `Automations`, `Usage` and `Thread usage` exist only while
  bb or the plugin providing them offers them; expect only what the run
  installed.
- The active mark in the drawer sits on the label inside the `menuitem`, not
  on the `menuitem` itself.
