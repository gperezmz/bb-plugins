# Provision a manifest from a machine bootstrap

Put your team's [manifest](../reference/team-onboarding-manifest.md) on a bb server from the script that sets the server up, so the checklist is ready before anyone opens it. Run every command here on the server, as the user bb runs as.

## Install the plugin and the manifest

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin team-onboarding --yes
bb team-onboarding manifest install ./onboarding.yaml
```

[`examples/bootstrap.sh`](../../plugins/team-onboarding/examples/bootstrap.sh) is the same as a script that takes the manifest's path.

`manifest install` validates the file first and refuses an invalid one, leaving any installed manifest in place. It writes to `<data dir>/team-onboarding/onboarding.yaml`, for example `/var/lib/bb/.bb/team-onboarding/onboarding.yaml`, through a temporary file and a rename, so the plugin never reads half a file. The plugin sees the new file within seconds.

## Or write the file with your own tool

A configuration management tool can put the file in place itself. Ask the plugin where; it adds ` (not there yet)` while the file is missing, which `sed` strips:

```sh
dest="$(bb team-onboarding manifest path | sed 's/ (not there yet)$//')"
install -D -m 0644 onboarding.yaml "$dest"
```

Validate it first, since a tool writing the file directly skips the check:

```sh
bb team-onboarding manifest validate onboarding.yaml
```

To keep the file elsewhere, such as in a folder your configuration tool owns, set the **Manifest file** setting to its absolute path:

```sh
bb plugin config team-onboarding set manifestFile /etc/bb/onboarding.yaml
```

The file must be called `onboarding.yaml` or `onboarding.yml`; [settings](../reference/team-onboarding-settings.md) has the rest of the rules.

## Set up a new machine

After a new machine joins bb, run the safe fixes there from the bootstrap of that machine, or from any thread on it:

```sh
bb team-onboarding apply --safe --machine laptop
```

It runs every [safe fix](../reference/team-onboarding-items.md#safe-fixes) on that machine and prints what is left for a person, such as logins, uploading the SSH key, and approvals.

## Update the manifest

Install the new version the same way. The plugin reloads it within seconds; a team command whose text changed waits for [approval](team-onboarding-approve-commands.md) again.
