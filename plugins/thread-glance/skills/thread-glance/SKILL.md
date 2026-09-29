---
name: thread-glance
description: "Reads and changes the Thread Glance sidebar's layout preferences with `bb thread-glance prefs`: grouping, sort, group order, hidden and collapsed groups, child-thread folding, when threads settle, archived threads, which child threads Needs attention counts, harness icons. Use when asked to change how the Thread Glance sidebar lists, groups, sorts, hides, collapses, folds or settles threads or draws their harness icon."
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
bb thread-glance prefs set settleAfter 3d
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
| `showArchived` | `true` lists archived threads in every group | `false` |
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
| `settleAfter` | Settle after: how long a quiet thread goes without activity before its tree can settle into the group's "Settled (N)" fold: `12h`, `1d`, `3d`, `1w` or `never` (then nothing settles) | `1d` |
| `openSettledFolds` | Group ids whose settled fold is open | `[]` |
| `expandedOlder` | Parent thread ids whose "N more child threads" row is open, once that tree's children chip is open | `[]` |
| `expandedChildren` | Parent thread ids whose chip is open | `[]` |
| `childAttention` | Needs attention counts every child. Which child threads need attention (collapsed groups, the need-you filter, counters, auto-reveal) and stay out of a tree's "N more child threads" fold alongside running ones: `blocked` counts a child that waits on you, is offline, or has an orphaned failure (its parent thread idle for 5 seconds since it failed); `everything` also counts every failed or unread child | `blocked` |
| `harnessIcon` | How rows that draw a harness logo draw it: `muted` (monochrome) or `colour` (the provider's tint). A row draws one only where its harness differs from bb's default (a root) or its parent thread's (a child) | `muted` |

Density (row spacing, Compact or Comfortable) and the Branch line switch (a
thread off its project's default branch names the branch on a second line)
are kept per device in the browser, and the need-you filter per browser
window; the CLI cannot read or change any of them. A tree that needs attention always stays in its
group, drawn even when the group is collapsed.

Sections themselves and the section a thread is in are bb core state: use
`bb thread section` and `bb thread update`.
