# Thread Glance: preferences and `bb thread-glance prefs`

Thread Glance keeps two kinds of preference. **Server preferences** are stored by the plugin on the bb server and follow you to every window and device. **Device preferences** are stored in the browser and stay in that browser. Source: [`shared/preferences.ts`](../../plugins/thread-glance/shared/preferences.ts).

## The settings popover

The gear alone on the slim row at the top of the list opens one panel.

| Heading | Setting | Preference |
|---|---|---|
| List | Group by: Project, Custom, Machine | `organizationMode` |
| List | Sort by: Updated, Created, A–Z | `chronologicalSort` |
| List | ↓/↑ beside Sort by: ↓ descending (newest first, Z–A), ↑ ascending | `sortDirection` |
| List | Working threads first | `workingFirst` |
| List | Worktrees as folders | `environmentGrouping` |
| List | Collapse older threads | `foldOlder` |
| Rows | Density: Compact, Comfortable | device |
| Rows | Harness icon: Muted, Colour, Hidden | `harnessIcon` |
| Rows | Pull request badge | `showPullRequests` |
| Show | Threads: Active, Archived, Both | `threadLifecycles` |
| Show | Needs you counts every child | `childAttention` |

Choosing a **Sort by** field starts it in its own direction: newest first for dates, A–Z for names.

## Server preferences

`bb thread-glance prefs list` prints each key with its value and a description. Keys, defaults and values:

| Key | Default | Values |
|---|---|---|
| `organizationMode` | `"project"` | `project`, `chronological` (Custom sections), `machine` |
| `environmentGrouping` | `false` | `true` folds sibling threads that share a worktree into a folder row |
| `chronologicalSort` | `"updated"` | `updated`, `created`, `alpha`; `none` is read as `updated` |
| `sortDirection` | `"default"` | `ascending` or `descending`; a saved `default` reads as the field's own direction (descending for dates, ascending for `alpha`) |
| `workingFirst` | `false` | `true` sorts working threads first under Updated, as bb's list does |
| `foldOlder` | `true` | Collapse older threads: `true` folds a group's [quiet](../explanation/thread-glance-attention.md#families-and-folding) roots past its 5 newest behind an `N older` row; `false` shows every root. The fold inside an open family does not read it |
| `harnessIcon` | `"muted"` | `muted`, `colour`, `hidden` |
| `showPullRequests` | `true` | Whether rows show a pull request badge |
| `threadLifecycles` | `["active"]` | `["active"]`, `["archived"]` or both (Threads: Active, Archived, Both); at least one |
| `childAttention` | `"blocked"` | Needs you counts every child: `blocked` (off) or `everything` (on). Which children need you and stay out of a family's fold; see [what a child adds](../explanation/thread-glance-attention.md#what-a-child-thread-adds) and [folding](../explanation/thread-glance-attention.md#families-and-folding) |
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
| `expandedChildren` | `[]` | Parent thread ids whose chip you opened |

A stored value that does not fit its key is ignored and the default used. The `nesting` and `collapsedChildren` keys are gone: a saved `nesting: "tree"` is no longer read, so the list draws children behind chips, and `bb thread-glance prefs set nesting tree` fails with `unknown_preference`.

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

The first time Thread Glance loads, it copies your layout from bb's own list: grouping, sort, direction, group order, hidden groups and collapsed groups. It reads bb's list's browser copy, or `bb thread-list prefs list --json` when the browser has none. It runs once per install, never overwrites a key the plugin already has, and skips which parents you collapsed in bb's list, because Thread Glance stores which chips you opened, not which you closed.
