---
name: thread-glance
description: "Reads and changes the Thread Glance sidebar's layout preferences with `bb thread-glance prefs`: grouping, sort, group order, hidden and collapsed groups, child-thread folding, which child threads Needs attention counts, harness icons. Use when asked to change how the Thread Glance sidebar lists, groups, sorts, hides, collapses or folds threads or draws their harness icon."
---

# Thread Glance preferences

Thread Glance keeps its own layout preferences, separate from bb's built-in
list. `bb thread-list prefs` changes bb's list and has no effect on Thread
Glance; use `bb thread-glance prefs` for it.

```sh
bb thread-glance prefs list [--json]
bb thread-glance prefs get <key> [--json]
bb thread-glance prefs set <key> <value> [--json]
bb thread-glance prefs reset <key> [--json]
```

`set` takes JSON, and a bare word is read as a string:

```sh
bb thread-glance prefs set sortDirection ascending
bb thread-glance prefs set threadLifecycles '["active","archived"]'
bb thread-glance prefs set hiddenGroups '["threads","project:<project-id>"]'
```

A list value replaces the whole list. To add or remove one item, `get` the
key, edit the list, and `set` the result. A value the key's schema rejects
fails with `invalid_preference_value` and leaves the stored value as it was;
an unknown key fails with `unknown_preference`. Every open window applies a
change at once. `reset` restores the default.

## Keys

`prefs list` prints each key's current value and a one-line description.
Ids come from `bb project list`, `bb thread section list`, `bb machine list`
and `bb environment list`; a thread id is a `thr_…` id.

| Key | Values | Default |
| --- | --- | --- |
| `threadLifecycles` | `active`, `archived`, or both; at least one | `["active"]` |
| `organizationMode` | `project`, `chronological` (custom sections) or `machine` | `project` |
| `environmentGrouping` | `true` folds sibling threads sharing a worktree into a folder row | `false` |
| `chronologicalSort` | `updated`, `created` or `alpha`; `none` reads as `updated` | `updated` |
| `sortDirection` | `ascending` or `descending`; a saved `default` reads as the field's own direction (descending for dates, ascending for `alpha`) | `default` |
| `sectionOrder` | Top-level order by project: `pinned`, `projects`, `threads` | all three |
| `manualSectionOrder` | Top-level order chronologically: `pinned`, `sections`, `threads` | all three |
| `machineSectionOrder` | Top-level order by machine: `pinned`, `machines`, `threads` | all three |
| `hiddenGroups` | Groups moved into More: `threads`, `project:<id>`, `section:<id>`, `machine:<id>` | `[]` |
| `collapsedSections` | Collapsed built-in groups: `pinned`, `threads` | `[]` |
| `collapsedProjects` | Project ids | `[]` |
| `collapsedThreadSections` | Custom section keys, `section:<id>` | `[]` |
| `collapsedMachines` | Machine ids | `[]` |
| `collapsedEnvironments` | Environment ids of collapsed folder rows | `[]` |
| `foldOlder` | Collapse older threads: `true` folds a group's quiet top-level threads past its 5 newest behind an "N older" row | `true` |
| `workingFirst` | `true` sorts working threads first under `updated` | `false` |
| `expandedOlder` | Group ids and parent thread ids whose "N older" or "N more child threads" row is open | `[]` |
| `expandedChildren` | Parent thread ids whose chip is open | `[]` |
| `showPullRequests` | `true` shows a pull request badge on rows | `true` |
| `childAttention` | Needs attention counts every child. Which child threads need attention (the Needs attention section, counters, auto-reveal) and stay out of a family's "N more child threads" fold alongside running ones: `blocked` counts a child that waits on you, is offline, or has an orphaned failure (its parent thread idle since); `everything` also counts every failed or unread child | `blocked` |
| `harnessIcon` | How rows draw the harness logo: `muted` (monochrome), `colour` (the provider's tint) or `hidden` | `muted` |

Row density is kept per browser, and the CLI cannot read or change it. No
preference filters the list: families that need attention always move into the
Needs attention section.

Sections themselves and the section a thread is in are bb core state: use
`bb thread section` and `bb thread update`.
