# Team Onboarding

A live setup checklist for your team, inside [bb](https://getbb.app). Your team describes its setup once in an `onboarding.yaml`: GitHub access, SSH, agent logins, skills, plugins, tools and its own checks. The **Onboarding** page checks each item on every machine where your agents run, fixes it when it safely can, opens a terminal with the right command when it can't, and keeps checking, so a new team skill or an expired login shows up by itself.

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin team-onboarding
```

- [First run and a first manifest](../../docs/tutorials/team-onboarding-first-run.md)
- [Provision a manifest from a machine bootstrap](../../docs/how-to/team-onboarding-provision-manifest.md)
- [Approve your team's commands](../../docs/how-to/team-onboarding-approve-commands.md)
- [Manifest](../../docs/reference/team-onboarding-manifest.md), with an [example](examples/onboarding.yaml) and the [JSON Schema](schema/onboarding.schema.json)
- [Items, statuses and safe fixes](../../docs/reference/team-onboarding-items.md)
- [`bb team-onboarding`](../../docs/reference/team-onboarding-cli.md)
- [Settings](../../docs/reference/team-onboarding-settings.md)
- [How Team Onboarding checks machines](../../docs/explanation/team-onboarding-checks.md)
- [Develop](../../docs/how-to/develop-plugins.md)

## Licence

MIT, see [`LICENSE`](LICENSE). Bundled third-party code is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
