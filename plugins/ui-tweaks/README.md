# UI Tweaks

Appearance settings that [bb](https://getbb.app) lacks. It starts with two for the conversation transcript: the size of its text, and the width of the transcript and composer columns. Both are under Settings → Plugins → UI Tweaks, drawn like the rows of bb's Settings → Appearance:

```text
Transcript text size                          [ Small | Medium | Large ]
Size of the conversation transcript text.

Transcript width                              [ Narrow | Medium | Wide ]
Maximum width of the transcript and composer columns.
```

Medium is bb's own look for both. Small and Large set message text to 12 px and 15 px, around bb's 13 px. Narrow and Wide set the columns to 640 px and 960 px, around bb's 760 px. A change reaches every open window at once. The settings apply to bb's own thread views, the main one and split panes, and never on a phone.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin ui-tweaks
```

- [Settings](../../docs/reference/ui-tweaks-settings.md): what each choice changes, where it applies, and what happens when a bb update changes the thread view
- [Install, update or remove a plugin](../../docs/how-to/install-plugins.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
