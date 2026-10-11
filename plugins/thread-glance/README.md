# Thread Glance

A sidebar thread list for [bb](https://getbb.app) that keeps threads on shelves. It replaces the built-in thread list and keeps bb's own thread actions and state. Snooze a thread until a time, park it while someone else replies, or settle it when it is done, and the list moves it off Active and brings it back when its time comes or new attention arrives. Active keeps the order you give it by dragging, cards show each thread's project, branch, children and pull request, and threads that have gone quiet settle by themselves.

```sh
bb plugin install 'git:https://github.com/gperezmz/bb-plugins.git@^0.11.0' --plugin thread-glance --tag-prefix thread-glance/
```

That installs 0.11.2; the pages describe the shelf list, which ships in 1.0.0.

Then choose **Thread Glance** under Settings → Appearance → Sidebar.

What becomes of `bb thread-glance prefs` and the `thread-glance` agent skill is in [Where a new install starts](../../docs/reference/thread-glance-settings.md#where-a-new-install-starts).

- [First run](../../docs/tutorials/thread-glance-first-run.md)
- [Switch the sidebar between Thread Glance and bb's list](../../docs/how-to/thread-glance-switch-sidebar.md)
- [The list, its shelves and rows](../../docs/reference/thread-glance-list.md)
- [Actions, menus and reordering](../../docs/reference/thread-glance-actions.md)
- [Settings and what it stores](../../docs/reference/thread-glance-settings.md)
- [Why Thread Glance keeps threads on shelves](../../docs/explanation/thread-glance-shelves.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
