# Thread Glance: preferences and `bb thread-glance prefs`

Thread Glance keeps two kinds of preference. **Server preferences** are stored by the plugin on the bb server and follow you to every window and device. **Device preferences** are stored in the browser and stay in that browser. Source: [`shared/preferences.ts`](../../plugins/thread-glance/shared/preferences.ts).

## The settings panel

The settings button, a sliders icon at the right of the [list header](thread-glance-states.md#the-list-header), opens the panel as a dropdown under the header; using it again closes it.

| Heading | Setting | Preference |
|---|---|---|
| List | Group by: Project, Custom, Machine | `organizationMode` |
| List | Sort by: Updated, Created, A–Z | `chronologicalSort` |
| List | ↓/↑ beside Sort by: ↓ descending (newest first, Z–A), ↑ ascending | `sortDirection` |
| List | Worktrees as folders | `environmentGrouping` |
| List | Settle after: 12h, 1d, 3d, 1w, Never | `settleAfter` |
| Rows | Density: Compact, Comfortable | [device](#device-preferences) |
| Rows | Branch line | [device](#device-preferences) |
| Rows | Harness icon: Muted, Colour | `harnessIcon` |
| Attention | Needs attention counts every child | `childAttention` |

Choosing a **Sort by** field starts it in its own direction: newest first for dates, A–Z for names. Each group's **…** menu holds **Show archived threads** (`showArchived`), which shows archived threads in every group.

## Device preferences

Density and Branch line are kept in the browser's `localStorage`, so each device has its own and a change on one leaves the others as they were. Changing either leaves the other as it was. The CLI cannot read or change them.

### Density

Density is row spacing. Compact is the default. Comfortable makes thread rows and fold rows 4 px taller and doubles the space before each group header:

| Row | Compact | Comfortable |
|---|---|---|
| Thread row, one line | 28 px (phones 36) | 32 px (phones 40) |
| Thread row, two lines (a note or a branch line) | 44 px (phones 48) | 48 px (phones 52) |
| "N more child threads" fold row | 28 px (phones 36) | 32 px (phones 40) |
| Environment fold row | 28 px (phones 36) | 32 px (phones 40) |
| Group header, list header | 28 px (phones 36) | 28 px (phones 36) |
| Settled fold | 24 px (phones 36) | 24 px (phones 36) |
| Space above a group header | 4 px | 8 px |

The list header and the first group shown get no space above them; every group header after the first gets it, a collapsed group's included. A phone is whatever bb calls a compact viewport: bb tells the list when it is one (phone-width viewports and coarse pointers), and Thread Glance draws and sizes everything by that, without a width test of its own.

### Branch line

While **Branch line** is on, a row with no note whose branch is not its project's default shows that branch on a [second line](thread-glance-states.md#the-second-line), in either density. It is off by default.

A device that saved a density on Thread Glance 0.5.0 or earlier and no Branch line choice opens with Branch line on if that density was Comfortable, and off if it was Compact.

## Server preferences

`bb thread-glance prefs list` prints each key with its value and a description. Keys, defaults and values:

| Key | Default | Values |
|---|---|---|
| `organizationMode` | `"project"` | `project`, `chronological` (Custom sections), `machine` |
| `environmentGrouping` | `false` | `true` folds sibling threads that share a worktree into a folder row |
| `chronologicalSort` | `"updated"` | `updated`, `created`, `alpha`; `none` is read as `updated` |
| `sortDirection` | `"default"` | `ascending` or `descending`; a saved `default` reads as the field's own direction (descending for dates, ascending for `alpha`) |
| `settleAfter` | `"1d"` | Settle after: `12h`, `1d`, `3d`, `1w` or `never`; how long a quiet thread goes without activity before it [settles](../explanation/thread-glance-attention.md#settled-threads). With `never`, nothing settles |
| `harnessIcon` | `"muted"` | `muted` or `colour`; a stored `hidden` reads as `muted`, and `prefs set` refuses it |
| `showArchived` | `false` | Show archived threads: `true` lists archived threads in every group |
| `childAttention` | `"blocked"` | Needs attention counts every child: `blocked` (off) or `everything` (on). Which children need attention and stay out of a tree's fold; see [what a child adds](../explanation/thread-glance-attention.md#what-a-child-thread-adds) and [folding](../explanation/thread-glance-attention.md#trees-and-folding) |
| `sectionOrder` | `["pinned","projects","threads"]` | Group order when grouped by project |
| `manualSectionOrder` | `["pinned","sections","threads"]` | Group order in Custom mode |
| `machineSectionOrder` | `["pinned","machines","threads"]` | Group order when grouped by machine |
| `hiddenGroups` | `[]` | Groups moved into **More**: `threads`, `project:<id>`, `section:<id>`, `machine:<id>` |
| `collapsedSections` | `[]` | Built-in groups (`pinned`, `threads`) that are collapsed |
| `collapsedProjects` | `[]` | Project ids whose group is collapsed |
| `collapsedThreadSections` | `[]` | `section:<id>` keys whose group is collapsed |
| `collapsedMachines` | `[]` | Machine ids whose group is collapsed |
| `collapsedEnvironments` | `[]` | Environment ids whose folder row is collapsed |
| `expandedOlder` | `[]` | Parent thread ids whose `N more child threads` row you opened, once that tree's children chip was open |
| `openSettledFolds` | `[]` | Group ids whose [settled fold](thread-glance-states.md#the-settled-fold) you opened |
| `expandedChildren` | `[]` | Parent thread ids whose chip you opened |

A stored value that does not fit its key is ignored and the default used. These keys are gone, a value saved under one no longer changes the list, and `bb thread-glance prefs set` fails on each with `unknown_preference`:

| Key | Was | Now |
|---|---|---|
| `workingFirst` | Working threads first | Rows keep their sort order when a thread starts or stops |
| `foldOlder` | Collapse older threads | The settled fold, set by `settleAfter`; a saved `false` leaves Settle after at `1d` |
| `showPullRequests` | Pull request badge | The badge always shows |
| `threadLifecycles` | Threads: Active, Archived, Both | `showArchived`; a saved value is not carried over, and the view of archived threads alone is gone |
| `nesting`, `collapsedChildren` | Children drawn as a tree | Children sit behind chips |

## `bb thread-glance prefs`

| Command | Does |
|---|---|
| `bb thread-glance prefs list [--json]` | Prints every key, its value and its description |
| `bb thread-glance prefs get <key> [--json]` | Prints one value |
| `bb thread-glance prefs set <key> <value> [--json]` | Sets one value. The value is JSON; a bare word is read as a string |
| `bb thread-glance prefs reset <key> [--json]` | Restores the default |

```sh
bb thread-glance prefs set organizationMode machine
bb thread-glance prefs set hiddenGroups '["threads"]'
bb thread-glance prefs reset hiddenGroups
```

Every open window follows a change at once. The plugin's agent skill sends an agent asked to change the sidebar's layout to the same commands.

## Where a new install starts

A new install starts from the defaults in the tables above. Thread Glance does not read bb's built-in list's preferences, from its browser copy or from `bb thread-list prefs`, so neither a change there nor the layout it had before Thread Glance was chosen reaches Thread Glance. Set the layout with the list's settings or `bb thread-glance prefs`. An install that has run an earlier version keeps the preferences it already stored.
