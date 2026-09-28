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
| Rows | Density: Compact, Comfortable | device |
| Rows | Harness icon: Muted, Colour | `harnessIcon` |
| Attention | Needs attention counts every child | `childAttention` |

Choosing a **Sort by** field starts it in its own direction: newest first for dates, A–Z for names. Each group's **…** menu holds **Show archived threads** (`showArchived`), which shows archived threads in every group.

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

Every open window follows a change at once. The plugin's agent skill documents the same commands, so an agent asked to change the sidebar's layout uses them.

## First-run import

The first time Thread Glance loads, it copies your layout from bb's own list: grouping, sort, direction, group order, hidden groups, collapsed groups and collapsed folder rows, and whether worktrees are folders, where bb's `auto` becomes off. It reads bb's list's browser copy, or, when the browser has none, runs `bb thread-list prefs list --json` against the bb server Thread Glance runs in, never the machine's default one. When it cannot tell which server that is, it logs a warning and imports nothing from the CLI. It runs once per install, never overwrites a key the plugin already has, and skips which parents you collapsed in bb's list, because Thread Glance stores which chips you opened, not which you closed.
