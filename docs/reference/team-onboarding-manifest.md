# Team Onboarding: manifest

A team describes its setup in one YAML file, `onboarding.yaml`, usually kept in a repository it owns. Team Onboarding reads it from a file on the bb server and turns each entry into a checklist [item](team-onboarding-items.md), checked on every machine it applies to. [Provision a manifest](../how-to/team-onboarding-provision-manifest.md) says where the file goes. Source: [`src/core/manifest.ts`](../../plugins/team-onboarding/src/core/manifest.ts).

A complete example is [`examples/onboarding.yaml`](../../plugins/team-onboarding/examples/onboarding.yaml). Editors validate against [`schema/onboarding.schema.json`](../../plugins/team-onboarding/schema/onboarding.schema.json) when the file starts with:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/gperezmz/bb-plugins/main/plugins/team-onboarding/schema/onboarding.schema.json
```

`bb team-onboarding manifest validate onboarding.yaml` checks a file from a thread or a shell. Every error names its line.

While the installed file is invalid, the checklist keeps the last good version from the same path and the settings section shows the errors. The manifest's version is the file's sha256.

## Top level

| Field | Type | Default | Meaning |
|---|---|---|---|
| `schema` | `1` | required | Manifest format version |
| `team.name` | string | required | Shown in the checklist |
| `team.docsUrl` | `https:` URL | none | Your team's own onboarding docs |
| `machines` | machine rule | `all` | Where items run unless their section or entry says otherwise |
| `github`, `ssh`, `providers`, `skills`, `plugins`, `marketplaces`, `tools`, `env`, `checks` | sections | empty | Below |

A **machine rule** is `server` (the [server machine](../explanation/how-the-plugins-fit-bb.md#where-each-part-runs)), `all` (every persistent machine; machines a provider creates and removes are left out), or a list of machine names as they appear in Settings → Machines.

Every entry has an `id` (`env` entries a `name`). Ids are what the plugin stores and logs; repository URLs and organisation names are never stored outside the cached manifest. Ids of access, skills, marketplace, tool and check entries use lowercase letters, digits, `.`, `_` and `-`, at most 64 characters; provider and plugin ids are bb's own ids. Unknown fields and unknown `source` or `kind` values are errors.

Most entries take `required` (default `true`). Optional items appear under **Nice to have** and never count toward the sidebar badge.

## `github`

| Field | Default | Meaning |
|---|---|---|
| `host` | `github.com` | GitHub host |
| `mode` | `builtin` | `builtin`: one login on the server machine, which bb's built-in git shares with every other machine. `per-machine`: every machine gets its own gh login and SSH key; switching turns off bb's built-in git server-wide, after a confirmation |
| `scopes` | none | Extra gh scopes to ask for, e.g. `write:public_key`, `read:public_key`, `workflow`. gh's defaults (`repo`, `read:org`, `gist`) are always there |
| `signing.required` | `false` | Adds **Signed commits** (SSH signing, verified with a test commit) |
| `access` | none | Repositories agents must be able to read; fields below |
| `machines` | top level | Where per-machine items run |

Each `access` entry:

| Field | Default | Meaning |
|---|---|---|
| `id` | required | Item id |
| `repo` | required | `owner/repo` |
| `title` | `Access to <id>` | Shown in the checklist |
| `required` | `true` | |
| `machines` | the server; `github.machines` in `per-machine` mode | Where to check |

Access results are categories: `ok`, `no-auth`, `no-access` (GitHub answers the same for "no such repository"), `sso-required`, `network`, `host-key`.

## `ssh`

Present, even as `ssh: {}`, it turns the SSH items on: a key named `bb_ed25519` at an absolute path, GitHub's pinned host keys, a plugin-owned SSH config used through `core.sshCommand`, the key on GitHub, and signing when asked for. `~/.ssh/config` is never edited. In `builtin` mode the items apply to the server machine only. `per-machine` mode and `signing` turn them on by themselves.

| Field | Default |
|---|---|
| `enabled` | `true` |
| `required` | `true` |
| `machines` | `github.machines` |

## `providers`

One entry per agent that must be installed and logged in.

| Field | Default | Meaning |
|---|---|---|
| `id` | required | bb's provider id: `claude-code`, `codex`, `pi`, `acp-cursor`, … |
| `required` | `true` | |
| `machines` | top level | Where to check |

Each is checked on each machine: installed, logged in, recent enough.

## `skills`

Team skills go into bb's own skill folder on the server machine, `<data dir>/skills`. bb gives them to every agent on every machine, so nothing is installed per machine. Every entry takes `id`, `title` (default `Team skills: <id>`), `required` and `source`, and then the fields of its source:

| `source` | Fields | Installs |
|---|---|---|
| `git` | `url`; `ref` (default `main`; a branch is tracked, a tag or SHA pinned); `paths` (default `["skills/*"]`; `*` is one folder level, `**` any); `exclude` | Every folder with a `SKILL.md` that `paths` matches |
| `apm` | `url`, `ref` and `path` (default `apm.yml`), or `package` (`owner/repo[/subpath][#ref]`) | The dependencies an `apm.yml` lists, or one APM package, resolved through git |
| `registry` | `registrySkillId` (`<source>/<skillId>`) | One skill from skills.sh |
| `plugin` | `install`, a plugin source as in `plugins`; `id` is the plugin id | A bb plugin that bundles skills, after [approval](team-onboarding-items.md#approvals) |

```yaml
skills:
  - id: team-skills
    source: git
    url: https://github.com/example-org/agent-skills.git
    ref: main
    paths: ["skills/*"]
    exclude: ["skills/experimental-*"]
  - id: one-package
    source: apm
    package: example-org/agent-skills/packages/engineering#v1
  - id: tdd
    source: registry
    registrySkillId: example-org/tdd
```

A skill folder's `SKILL.md` needs a `name` equal to the folder name and a `description`. Symlinks that leave the source repository, more than 1000 files or more than 10 MiB reject that skill, and its previous version stays. A new commit on a tracked branch shows **Update** with the added, changed and removed skills and each `SKILL.md` diff. A folder you made by hand with the same name is never overwritten: **Rename mine** or **Replace with team version**. A skill edited in place shows **Keep my edits** or **Restore team version**.

## `plugins` and `marketplaces`

Each `plugins` entry:

| Field | Default | Meaning |
|---|---|---|
| `id` | required | The bb plugin id |
| `install` | required | `<entry>@<marketplace>`, `git:<url>[@ref]`, `npm:<name>@<version>` or an `https://` URL |
| `title` | the id | Shown in the checklist |
| `settings` | none | Plugin settings to preset, non-secret values only |
| `required` | `true` | |

Each `marketplaces` entry has `id`, `source` (the marketplace's location, e.g. `git:<url>`) and `required`.

```yaml
marketplaces:
  - { id: team, source: "git:https://github.com/example-org/bb-marketplace.git" }
plugins:
  - id: floating-terminal
    install: floating-terminal@bb-community
    settings: { fontSize: 13 }
```

Plugins and marketplaces live on the server. Each source waits for [approval](team-onboarding-items.md#approvals) before it installs. Updates are applied by hand.

## `tools`

| Field | Default | Meaning |
|---|---|---|
| `id` | required | Item id |
| `title` | the id | Shown in the checklist |
| `check.bin` | required | A bare program name found on `PATH`, run without a shell |
| `check.args` | `["--version"]` | A version flag; see below |
| `check.pattern` | `(\d+\.\d+(?:\.\d+)?)` | Regular expression whose first group is the version |
| `min` | none | Lowest version that passes: `2`, `2.60` or `2.60.1` |
| `hint` | none | An `https:` link to install instructions |
| `install` | none | A one-line **team command**, typed into a terminal after [approval](team-onboarding-items.md#approvals) |
| `required` | `true` | |
| `machines` | top level | Where to check |

```yaml
tools:
  - id: gh
    check: { bin: gh, args: ["--version"], pattern: "(\\d+\\.\\d+\\.\\d+)" }
    min: "2.60"
    hint: https://cli.github.com
    install: "brew install gh"
```

Tool checks run on every machine without approval, so `args` must be a version flag: `--version` or `-V`. JVM tools (java, kotlin, scala, …) may use `-version`. Tools that report their version with a subcommand (go, kubectl, docker, helm, terraform and a few more) may also use `version`, `version --client` or `version --short`. Programs that launch other programs or fetch packages (`env`, `npx`, `sudo`, …) are refused. A shell string in `check`, or any other arguments, is an error; put anything else in `checks`.

## `env`

| Field | Default | Meaning |
|---|---|---|
| `name` | required | The variable, in `UPPER_SNAKE_CASE` |
| `note` | none | Shown beside the form, e.g. where to get the value |
| `required` | `true` | |

Names only: the engineer types the value into a masked form, and it is stored as a bb machine variable, which every agent on every machine can read. `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GIT_CONFIG_*` are refused because they override bb's built-in git.

## `checks`

| Field | Default | Meaning |
|---|---|---|
| `id` | required | Item id |
| `title` | required | Shown in the checklist |
| `description` | none | One line under the title |
| `run` | required | A shell command; exit code 0 passes |
| `fix` | none | `{ kind: run, command }` runs the command; `{ kind: terminal, command }` opens a terminal on the machine with the one-line command typed, for the engineer to press Enter |
| `required` | `true` | |
| `machines` | top level | Where to run |

```yaml
checks:
  - id: vpn
    title: Company VPN reachable
    run: "curl -sfm5 https://internal.example.com/health"
    machines: server
    fix: { kind: terminal, command: "sudo systemctl start example-vpn" }
```

`checks[].run`, `checks[].fix` and `tools[].install` are **team commands**: each runs only after [approval](team-onboarding-items.md#approvals), and a custom fix never runs in bulk.
