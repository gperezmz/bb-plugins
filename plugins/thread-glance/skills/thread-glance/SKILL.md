---
name: thread-glance
description: Sets the Thread Glance sidebar via `bb thread-glance prefs`, covering shelves, snooze, park, settle, manual order, project colours, Thread display (full cards, compact working or all threads), Project icon only, the order of child threads, and how the sidebar groups (Group by worktree among them), sorts, hides, collapses, folds and settles threads. Use as the tool for sidebar changes with Thread Glance installed, not `bb thread-list`.
---

# Thread Glance settings

Thread Glance keeps its own settings. While it is the sidebar's list,
`bb thread-list prefs set` succeeds and changes nothing the user sees, so
check which list is in use before changing anything:

```sh
bb settings ui get sidebar.threadListProvider
```

- `thread-glance/thread-glance`: Thread Glance is the list.
- `__automatic__` (the default): bb picks the first thread list plugin other
  than its own `thread-list`, so Thread Glance is the list unless
  `bb plugin list` shows a third thread list plugin beside the two. With
  `thread-glance` installed and no third, Thread Glance is the list.
- `thread-list/thread-list` or the legacy `__builtin__`: bb's own list is in
  use. Thread Glance changes nothing the user sees.
- Any other value: another plugin's list. Change nothing and say so.

## Thread Glance is the list

`bb thread-glance prefs list` prints every setting with its value and what it
does; read it before `set`, since the keys are its field names
(`hoursBeforeInactive`, `childOrder`). A key of `bb thread-list`, such as
`organizationMode` or `hiddenGroups`, is not a key here.

```sh
bb thread-glance prefs list [--json]
bb thread-glance prefs get <key> [--json]
bb thread-glance prefs set <key> <value> [--json]
bb thread-glance prefs reset <key> [--json]
```

- `set` takes JSON and reads a bare word as a string:
  `bb thread-glance prefs set projectColours true`.
- A value the setting rejects fails with `invalid_preference_value`, and an
  unknown key with `unknown_preference`; both leave the stored value as it
  was, and the error says what the setting takes.
- Every open window applies a change at once.

A request for something that is not a setting is not done by the command, and
the user is told where to do it instead:

- Snoozing, parking, settling or reordering a thread: from the thread's menu
  (Snooze, Park, Settle), by dragging a row on Active, or with Alt+Arrow.
  Report that the user does it there; the command has no way to.
- What each device keeps for itself, such as collapsed shelves, collapsed
  project and worktree groups, Active's sort, expanded parents and the port
  link machine: from the list itself, or Settings → This device. The server cannot reach a
  device's storage, so `prefs set` does not change them.

## bb's own list is in use

Do not change a Thread Glance setting: the user would not see it, so
`bb thread-glance prefs set` is not run. For a request bb's list can carry out (sort,
organisation, collapse, hidden groups, row actions), run
`bb thread-list prefs set`, reading `bb thread-list prefs list` first. For a
request only Thread Glance can carry out (shelves, snooze, project colours,
Thread display, project icon only, automatic settling), tell the user Thread Glance is not the list in use. Offer
to switch the sidebar to Thread Glance, and switch only if asked:

```sh
bb settings ui set sidebar.threadListProvider thread-glance/thread-glance
```
