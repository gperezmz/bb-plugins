# Thread Glance

A sidebar thread list for [bb](https://getbb.app). It keeps everything bb's own list does, and shows at a glance each thread's state, the harness that runs it, and what its child threads are doing, without the child threads taking over the list. A **Needs attention** section at the top of the list holds every family with a thread only you can move forward.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-glance
```

Then choose **Thread Glance** under Settings → Appearance → Sidebar.

- [First run](../../docs/tutorials/thread-glance-first-run.md)
- [Switch the sidebar between Thread Glance and bb's list](../../docs/how-to/thread-glance-switch-sidebar.md)
- [States and glyphs](../../docs/reference/thread-glance-states.md)
- [Preferences and `bb thread-glance prefs`](../../docs/reference/thread-glance-preferences.md)
- [What "Needs attention" means](../../docs/explanation/thread-glance-attention.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
