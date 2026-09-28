# Pocket Navigation

bb's sidebar navigation for [bb](https://getbb.app), made small on a phone. Where bb draws six full-width rows (New thread, Plugins, Automations, Usage, Thread usage, More), Pocket Navigation draws a New thread line, with search at its right end, above one row of icons. Everywhere else it draws bb's own navigation, unchanged.

```text
[ ⊕  New thread               ][ 🔍 ]  search only when it is shown
[ ⏻ ][ ⟳ ][ ▥ ][ $ ][ … ]            every other visible entry, in bb's order
```

It follows the order and visibility you set in bb's own Customize sidebar, and changes neither: an entry you hide there sits behind "…". On a phone, "…" is always at the end of the icon row and opens Customize sidebar, whether or not anything is hidden.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin pocket-navigation
```

While bb's navigation is left on Automatic, bb uses it as soon as it is installed.

- [Switch the sidebar navigation between Pocket Navigation and bb's](../../docs/how-to/pocket-navigation-switch-navigation.md)
- [Install, update or remove a plugin](../../docs/how-to/install-plugins.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
