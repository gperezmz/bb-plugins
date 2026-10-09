---
name: thread-glance
description: Changes how the sidebar groups, sorts, hides and settles threads with `bb thread-glance prefs`, not `bb thread-list prefs`, when Thread Glance is its list. Use when asked to change the sidebar layout.
---

# Thread Glance preferences

Thread Glance keeps its own layout preferences. While it is the sidebar's list
(`bb settings ui get sidebar.threadListProvider` prints `thread-glance/thread-glance`),
`bb thread-list prefs` has no effect on the sidebar, and succeeds all the same;
use `bb thread-glance prefs`.

Run `bb thread-glance prefs list` for the keys, their values and what each
means, before `set`, and `bb thread-glance prefs --help` for the commands.

- `set` takes JSON, and a bare word is read as a string:
  `bb thread-glance prefs set hiddenGroups '["threads","project:<project-id>"]'`.
- A list value replaces the whole list. To add or remove one item, `get` the
  key, edit the list, and `set` the result.
- A value the key's schema rejects fails with `invalid_preference_value`, an
  unknown key with `unknown_preference`; both leave the stored value as it was.
- Every open window applies a change at once.
- Ids come from `bb project list`, `bb thread section list`,
  `bb machine list` and `bb environment list`; a thread id is a `thr_…` id.

What a few keys do beyond their description:

- `harnessIcon`: a row draws a harness logo only where its harness differs
  from bb's default (a root thread) or from its parent thread's (a child).
- `childAttention`: Needs attention drives collapsed groups, the need-you
  filter, the counters and auto-reveal, and the children kept out of a tree's
  "N more child threads" fold. An orphaned failure is a child's failure whose
  parent thread has stayed idle for 5 seconds without handling it.
- A tree that needs attention stays in its group, drawn even when the group
  is collapsed.

Density (Compact or Comfortable), the Branch line switch and the need-you
filter live in the browser, per device or per window; the CLI cannot read or
change them. Sections themselves and the section a thread is in are bb core
state: use `bb thread section` and `bb thread update`.
