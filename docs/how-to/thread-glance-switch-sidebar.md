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

bb's list has no shelves, so it draws snoozed, parked and settled threads as it draws any thread. Thread Glance keeps its shelves, settings and manual order on the server, so switching to it again brings them back. The two lists keep separate preferences: a change in bb's list is not copied to Thread Glance, and [a new install starts from Thread Glance's defaults](../reference/thread-glance-settings.md#where-a-new-install-starts). Both lists show the same threads, pins, read state and archive state, since those are bb's.

To see which list is active:

```sh
bb settings ui get sidebar.threadListProvider
```
