# Install, update or remove a plugin

Each plugin installs on its own, by name: `thread-glance`, `thread-usage`, `team-onboarding` or `openai-inference`, as listed in [`.bb/plugins.json`](../../.bb/plugins.json). Run these on any machine with the `bb` CLI; they act on the bb server.

## Install

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin thread-glance
```

bb shows what it will install and asks to confirm; `--yes` skips the question, for scripts. The bb server builds the plugin after cloning it, so it needs `npm` on its `PATH`.

Then turn it on where it shows:

- Thread Glance: [switch the sidebar to it](thread-glance-switch-sidebar.md).
- Thread Usage: nothing to do; the coin appears in a thread's header after its next turn.
- Team Onboarding: open **Onboarding** in the sidebar, and [put your team's manifest on the server](team-onboarding-provision-manifest.md).
- OpenAI-compatible inference: select one of its services with `BB_INFERENCE`, as its [first run](../tutorials/openai-inference-first-run.md#3-select-the-gateway) shows.

## Pin a release

Releases are tagged per plugin with the plugin's name as prefix, `thread-glance/v0.1.0` for example. Install a tag instead of `main`:

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@thread-glance/v0.1.0 --plugin thread-glance
```

or a semver range over one plugin's tags:

```sh
bb plugin install 'git:https://github.com/gperezmz/bb-plugins.git@^0.1.0' --plugin thread-glance --tag-prefix thread-glance/
```

## Update

```sh
bb plugin outdated
bb plugin update thread-glance
```

`bb plugin outdated` lists installed plugins with a compatible update; `bb plugin update --all` updates every one of them.

## Remove

```sh
bb plugin uninstall thread-glance
```

This deletes the plugin's settings, secrets and schedules. [What each plugin stores](../explanation/how-the-plugins-fit-bb.md#what-each-plugin-stores) says what stays behind. Before removing Thread Glance, [switch the sidebar back to bb's list](thread-glance-switch-sidebar.md#switch-back-to-bbs-list).
