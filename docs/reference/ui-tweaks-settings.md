# UI Tweaks: settings

Source: [`shared/tweaks.ts`](../../plugins/ui-tweaks/shared/tweaks.ts) for the choices and their sizes, [`features/ui-tweaks/model/css.ts`](../../plugins/ui-tweaks/features/ui-tweaks/model/css.ts) for what each choice changes, [`features/ui-tweaks/model/targets.ts`](../../plugins/ui-tweaks/features/ui-tweaks/model/targets.ts) for the parts of bb's thread view and New-thread screen it changes, [`server/store.ts`](../../plugins/ui-tweaks/server/store.ts) for how the choices are kept.

Both settings are under Settings → Plugins → UI Tweaks, each a row with a segmented control. Medium is the default for both and is bb's own look: with both on Medium the plugin adds nothing to the page.

## Text size

Size of the transcript and composer text. **Small**, **Medium** or **Large**.

| Choice | Message text and the text typed in the composer | Everything else in the transcript |
|---|---|---|
| Small | 12 px | 12/13 of bb's size |
| Medium | 13 px, bb's own | bb's size |
| Large | 15 px | 15/13 of bb's size |

It scales every text inside the transcript: messages, code blocks, headings, tool rows and cards. In the composer it scales only what you type, its placeholder and its mention pills. Line heights scale with it. The composer's controls keep bb's size: the + button, the model picker, the mic, the send button, the footer with the project, checkout, branch and permission mode, the mention menu, and any plugin's composer chip. So does the editor for a queued message. The collapsed composer, "Send a follow-up", keeps bb's height, with its placeholder scaled inside it. Text outside the transcript and the composer keeps bb's size: the sidebar, menus, headers and settings.

## Transcript width

Maximum width of the transcript and composer columns. **Narrow**, **Medium** or **Wide**.

| Choice | Maximum width of the transcript column, the composer and the New-thread screen's column |
|---|---|
| Narrow | 640 px |
| Medium | 760 px, bb's own |
| Wide | 960 px |

The columns always have the same width, so the New-thread screen's composer is as wide as the thread view's that replaces it once the first message is sent. Wide tables in messages break out to the chosen width as they do to bb's 760 px.

## Where they apply

Both settings apply to bb's own thread view, the main one and each split pane, and to the New-thread screen, bb's page for starting a thread, on the home page or in a split pane. They do not apply to:

- a phone, meaning a viewport at most 767 px wide with a coarse pointer, where bb's own sizes stay;
- a thread chat that another plugin embeds with bb's `ThreadChat` component.

A change reaches every open window at once, with no reload. The choices are kept on the bb server, so they apply in every browser and app window connected to it.

## When a thread view or New-thread screen differs from bb 0.44's

bb does not promise the parts of its thread view and New-thread screen that the plugin changes:

| Where | Part |
|---|---|
| Thread view | the transcript column (`.max-w-[760px]` with an inline `--md-content-w`) |
| Thread view | the composer column (`.chat-prompt-box.max-w-[760px]`) |
| Thread view | the composer's editor wrapper (`[data-follow-up-composer] [data-promptbox-editor-scroll]`), while the composer shows an editor |
| New-thread screen | its column (`.max-w-[760px]` with an inline `--md-content-w`) |
| New-thread screen | its editor wrapper (`[data-promptbox-editor-scroll]`) |
| Both | the text size variable `--text-sm` at `:root` |

The plugin knows a New-thread screen by its editor, `#root-compose-prompt`; a screen without it is left alone without a warning. A thread view or New-thread screen that lacks any of its parts after a bb update keeps bb's look under every choice. Once it has lacked one for 5 seconds, the plugin logs one warning for it in the browser console, starting `UI Tweaks: a thread view lacks` or `UI Tweaks: a New-thread screen lacks` and naming each part missing. With neither open it logs nothing.

## What is kept

The two choices are rows in the plugin's key-value store on the bb server, read over the plugin's RPC methods `getTweaks` and `setTweaks`:

```sh
bb plugin rpc call ui-tweaks getTweaks
```

They survive a bb restart and a plugin update. Removing and installing the plugin again starts both at Medium, as a first install does. Disabling the plugin puts bb's look back at once, leaving no style, attribute or variable behind, and enabling it again brings the choices back.
