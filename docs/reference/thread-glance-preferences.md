# Thread Glance: preferences and `bb thread-glance prefs`

Thread Glance keeps two kinds of preference. **Server preferences** are stored by the plugin on the bb server and follow you to every window and device. **Device preferences** are stored in the browser and stay in that browser. Source: [`shared/preferences.ts`](../../plugins/thread-glance/shared/preferences.ts).

## The settings popover

The gear at the top of the list opens four pages.

| Page | Setting | Preference |
|---|---|---|
| Organize | Group by: By project, Custom, By machine | `organizationMode` |
| Organize | Child threads: Folded, Tree | `nesting` |
| Organize | Groups: By environment | `environmentGrouping` |
| Sort | Sort by: Updated, Created, Alphabetical | `chronologicalSort` |
| Sort | Direction: Default, Ascending, Descending | `sortDirection` |
| Sort | Working first | `workingFirst` |
| Sort | Fold older threads | `foldOlder` |
| Display | Density: Compact, Comfortable | device |
| Display | Harness icon: Muted, Colour, Hidden | `harnessIcon` |
| Display | Pull requests | `showPullRequests` |
| Filter | Show: Active, Archived | `threadLifecycles` |
| Filter | Child threads in Needs attention: Blocked and orphaned failures, Everything | `childAttention` |

The **All** / **Needs attention** toggle above the list is a device preference too, so a phone's filter does not change the desktop's.

## Server preferences

`bb thread-glance prefs list` prints each key with its value and a description. Keys, defaults and values:

| Key | Default | Values |
|---|---|---|
| `organizationMode` | `"project"` | `project`, `chronological` (Custom sections), `machine` |
| `nesting` | `"folded"` | `folded`: one flat level behind a chip. `tree`: bb's indented tree |
| `environmentGrouping` | `false` | `true` folds sibling threads that share a worktree into a folder row |
| `chronologicalSort` | `"updated"` | `updated`, `created`, `alpha`; `none` is read as `updated` |
| `sortDirection` | `"default"` | `default`, `ascending`, `descending` |
| `workingFirst` | `false` | `true` sorts working threads first under Updated, as bb's list does |
| `foldOlder` | `true` | `true` folds [quiet](../explanation/thread-glance-attention.md#families-and-folding) roots past the 5 most recent behind an `N older` row |
| `harnessIcon` | `"muted"` | `muted`, `colour`, `hidden` |
| `showPullRequests` | `true` | Whether rows show a pull request badge |
| `threadLifecycles` | `["active"]` | Any of `active`, `archived`; at least one |
| `childAttention` | `"blocked"` | `blocked` or `everything`: which children count toward Needs attention and stay out of a family's fold; see [what a child adds](../explanation/thread-glance-attention.md#what-a-child-thread-adds) and [folding](../explanation/thread-glance-attention.md#families-and-folding) |
| `sectionOrder` | `["pinned","projects","threads"]` | Group order when grouped by project |
| `manualSectionOrder` | `["pinned","sections","threads"]` | Group order in Custom mode |
| `machineSectionOrder` | `["pinned","machines","threads"]` | Group order when grouped by machine |
| `hiddenGroups` | `[]` | Groups moved into **More**: `threads`, `project:<id>`, `section:<id>`, `machine:<id>` |
| `collapsedSections` | `[]` | Built-in groups (`pinned`, `threads`) that are collapsed |
| `collapsedProjects` | `[]` | Project ids whose group is collapsed |
| `collapsedThreadSections` | `[]` | `section:<id>` keys whose group is collapsed |
| `collapsedMachines` | `[]` | Machine ids whose group is collapsed |
| `collapsedEnvironments` | `[]` | Environment ids whose folder row is collapsed |
| `expandedOlder` | `[]` | Group ids and parent thread ids whose `N older` or `N more child threads` row you opened |
| `expandedChildren` | `[]` | Parent thread ids whose chip you opened (Folded) |
| `collapsedChildren` | `[]` | Parent thread ids you collapsed (Tree) |

A stored value that does not fit its key is ignored and the default used.

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

The first time Thread Glance loads, it copies your layout from bb's own list: grouping, sort, direction, group order, hidden groups and collapsed groups. It reads bb's list's browser copy, or `bb thread-list prefs list --json` when the browser has none. It runs once per install, never overwrites a key the plugin already has, and skips which parents you collapsed in bb's list, because Folded nesting stores which parents you opened, not which you closed.
