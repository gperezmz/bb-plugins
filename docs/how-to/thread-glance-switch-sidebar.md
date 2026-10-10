# Switch the sidebar between Thread Glance and bb's list

The sidebar draws one thread list at a time. The choice is a bb preference synced by the server, so it changes every bb window on every device at once.

## Use Thread Glance

In bb, open Settings → Appearance → Sidebar and choose **Thread Glance**.

From a shell or an agent:

```sh
bb settings ui set sidebar.threadListProvider thread-glance/thread-glance
```

## Switch back to bb's list

Choose **Thread list** under Settings → Appearance → Sidebar, or:

```sh
bb settings ui set sidebar.threadListProvider thread-list/thread-list
```

Thread Glance keeps its own preferences, so switching to it again brings back its layout. The two lists keep separate preferences: a change in bb's list is not copied to Thread Glance, and [a new install starts from Thread Glance's defaults](../reference/thread-glance-preferences.md#where-a-new-install-starts). Both lists show the same threads, sections, pins and archive state, since those are bb's.

To see which list is active:

```sh
bb settings ui get sidebar.threadListProvider
```
