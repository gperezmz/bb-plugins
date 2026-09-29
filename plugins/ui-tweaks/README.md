# UI Tweaks

Appearance settings that [bb](https://getbb.app) lacks. It starts with two: the size of the text you read and write, and the width of the transcript and composer columns. Both are under Settings → Plugins → UI Tweaks, drawn like the rows of bb's Settings → Appearance:

```text
Text size                                     [ Small | Medium | Large ]
Size of the transcript and composer text.

Transcript width                              [ Narrow | Medium | Wide ]
Maximum width of the transcript and composer columns.
```

Medium is bb's own look for both. Small and Large set message text and the text you type in the composer to 12 px and 15 px, around bb's 13 px; the composer's buttons and menus keep bb's size. Narrow and Wide set the columns to 640 px and 960 px, around bb's 760 px. A change reaches every open window at once. The settings apply to bb's own thread views, the main one and split panes, and to the New-thread screen, and never on a phone.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin ui-tweaks
```

- [Settings](../../docs/reference/ui-tweaks-settings.md): what each choice changes, where it applies, and what happens when a bb update changes the thread view or the New-thread screen
- [Install, update or remove a plugin](../../docs/how-to/install-plugins.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
