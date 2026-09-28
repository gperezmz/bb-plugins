# Switch the sidebar navigation between Pocket Navigation and bb's

The sidebar draws one navigation at a time: the New thread, search, Plugins and plugin panel entries above the thread list. The choice is a bb preference synced by the server, so it changes every bb window on every device at once. Pocket Navigation changes only what a phone shows; on a wider screen it draws bb's own navigation either way.

## Use Pocket Navigation

bb's navigation choice starts on **Automatic**, which takes the first navigation plugin installed, so installing Pocket Navigation is enough. To choose it by name, open Settings → Appearance and choose **Pocket Navigation** under **Navigation**, or from a shell or an agent:

```sh
bb settings ui set sidebar.navigationProvider pocket-navigation/pocket-navigation
```

## Choose what the phone shows

Pocket Navigation follows the order and visibility of bb's own **Customize sidebar**, and changes neither. On a phone, open it from the last item in "…" at the end of the icon row, which is there whether or not anything is hidden. On a wider screen, open it from bb's own More.

- An entry you hide there moves behind "…", New thread and search included.
- The icon row and "…" list entries in the order you set there.
- With nothing hidden, "…" holds only Customize sidebar.

## Switch back to bb's navigation

Choose **Navigation (built-in)** under Settings → Appearance → Navigation, or:

```sh
bb settings ui set sidebar.navigationProvider navigation/navigation
```

To see which navigation is chosen, where `"__automatic__"` means Automatic:

```sh
bb settings ui get sidebar.navigationProvider
```

To go back to Automatic:

```sh
bb settings ui reset sidebar.navigationProvider
```
