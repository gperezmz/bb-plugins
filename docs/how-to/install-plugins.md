# Install, update or remove a plugin

Each plugin installs on its own, by name: `thread-glance`, `thread-usage`, `team-onboarding`, `openai-inference`, `cache-keeper`, `ui-tweaks` or `unattendish-sdlc`, as listed in [`.bb/plugins.json`](../../.bb/plugins.json). Run these on any machine with the `bb` CLI; they act on the bb server.

## Install

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-glance
```

bb shows what it will install and asks to confirm; `--yes` skips the question, for scripts. The bb server builds the plugin after cloning it, so it needs `npm` on its `PATH`.

Then turn it on where it shows:

- Thread Glance: [switch the sidebar to it](thread-glance-switch-sidebar.md).
- Thread Usage: nothing to do; the coin appears in a thread's header after its next turn.
- Team Onboarding: open **Onboarding** in the sidebar, and [put your team's manifest on the server](team-onboarding-provision-manifest.md).
- OpenAI-compatible inference: add an Endpoint with its `model` and select it per AI task with `bb settings ai-services set`, as its [first run](../tutorials/openai-inference-first-run.md#3-add-the-gateway-as-an-endpoint) shows. Automatic never picks an Endpoint, and bb has no fallback from one selected service to another.
- Cache Keeper: it sends nothing until you switch something on; [compact a thread when it goes idle](cache-keeper-compact-a-thread.md) with the composer chip, as its [first run](../tutorials/cache-keeper-first-run.md) shows.
- UI Tweaks: nothing changes until you pick a choice other than Medium under Settings → Plugins → UI Tweaks; [its settings](../reference/ui-tweaks-settings.md) say what each does.
- Unattendish: it polls nothing until a manager registers a fleet; [connect the fleet to an account](unattendish-connect-a-fleet.md) that can read its repository and tracker, as its [first run](../tutorials/unattendish-first-run.md) shows. Its tokens are kept in its own `data.db`, which `bb plugin remove` leaves on disk: remove every account in Settings first to delete them.

## Pin a release

Releases are tagged per plugin with the plugin's name as prefix, `thread-glance/v1.0.0` for example. Install a tag instead of `main`:

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@thread-glance/v1.0.0 --plugin thread-glance
```

or a semver range over one plugin's tags:

```sh
bb plugin install 'git:https://github.com/gperezmz/bb-plugins.git@^1.0.0' --plugin thread-glance --tag-prefix thread-glance/
```

## Install a prebuilt package from npm

Each release is also published to npm as `@gperezmz/bb-plugin-<name>`, with its bundles already built:

```sh
bb plugin install 'npm:@gperezmz/bb-plugin-thread-glance@^1.0.0'
```

bb installs the package with its own copy of npm, and builds nothing. The package lists as dependencies only the few packages its server needs when bb loads it from source; the bundles hold the rest. A `git:` install instead clones the repository, installs the plugin's dependencies and builds it on the server, which takes minutes on a small machine. A range such as `^1.0.0` tracks updates the way a `git:` range does; an exact version such as `@1.0.0` pins it.

A plugin already installed from `git:` moves to npm only by removing it first, which deletes its settings, as [Remove](#remove) says.

## Update

```sh
bb plugin outdated
bb plugin update thread-glance
```

`bb plugin outdated` lists installed plugins with a compatible update; `bb plugin update --all` updates every one of them.

A range keeps an install inside its major version, or inside its minor version below 1.0.0: a Thread Glance installed from `@^0.11.0` stays on 0.11.2 and `bb plugin outdated` lists nothing for it. To move it to 1.0.0, remove it and install it again with the `@main` line above. Remove deletes its settings, and 1.0.0 starts from its [defaults](../reference/thread-glance-settings.md#where-a-new-install-starts) either way.

## Remove

```sh
bb plugin uninstall thread-glance
```

This deletes the plugin's settings, secrets and schedules. [What each plugin stores](../explanation/how-the-plugins-fit-bb.md#what-each-plugin-stores) says what stays behind. Before removing Thread Glance, [switch the sidebar back to bb's list](thread-glance-switch-sidebar.md#switch-back-to-bbs-list).
