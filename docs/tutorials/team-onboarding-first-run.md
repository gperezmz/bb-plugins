# Team Onboarding: first run and a first manifest

In this tutorial you install Team Onboarding, read its built-in checklist, write a small team manifest, install it, and approve a team command. You need a bb server you can install plugins on and a shell on it as the user bb runs as.

## 1. Install it

```sh
bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin team-onboarding
```

Click **Onboarding** in the sidebar. With no team manifest, the page runs its built-in checks: GitHub CLI on the server, the GitHub login, bb's built-in git on each machine, and each agent on each machine. At the end, a quiet line says that no team manifest is installed.

## 2. Read the checklist from a shell

```sh
bb team-onboarding status
```

The output lists the same items, grouped, with each machine's status in brackets:

```text
No manifest · 7 of 7 required items done · All set · checked just now

GitHub
  ✓ github.gh-installed  GitHub CLI on the server  [server:ok]
  ✓ github.login  Log in to GitHub  [server:ok]
  ✓ github.builtin-git  bb's built-in git  [server:ok laptop:ok]
...
```

Your items and machine names will differ. If an item is not `ok`, the page offers its fix; leave it for now.

## 3. Write a manifest

Create `onboarding.yaml` in your working directory:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/gperezmz/bb-plugins/main/plugins/team-onboarding/schema/onboarding.schema.json
schema: 1

team:
  name: My team

providers:
  - id: claude-code

tools:
  - id: git
    check: { bin: git, args: ["--version"], pattern: "(\\d+\\.\\d+)" }
    min: "2.30"
    hint: https://git-scm.com/downloads

checks:
  - id: hello
    title: The shell says hello
    run: "echo hello"
    machines: server
```

It asks for three things: Claude Code on every machine, git 2.30 or newer on every machine, and one team check that runs `echo hello` on the server.

Validate it:

```sh
bb team-onboarding manifest validate onboarding.yaml
```

It prints `Valid: My team.` Now break it on purpose: change the `check:` line to `check: "git --version"` and validate again. The error names the line and says a tool check cannot be a shell string. Put the line back.

## 4. Install it

```sh
bb team-onboarding manifest install onboarding.yaml
```

It prints where it installed the file and its sha256. Within a few seconds the Onboarding page shows **My team**, a **Tools** group with git, and a **Team checks** group. Run `bb team-onboarding status` again:

```text
Team checks
  ✓ core.manifest  My team manifest  [server:ok]
  ! check:hello  The shell says hello  [server:needs-approval]
      server: A command from your team. Review it before it runs.
```

`echo hello` has not run. It comes from the manifest, so it waits for you.

## 5. Approve the team command

On the Onboarding page, open **The shell says hello**. Under **Commands from your team** it shows `echo hello` exactly as written. Click **Approve**, then **Recheck** on the row. The item turns green.

Open the **Team manifest** tab: the command is listed there as approved, with **Revoke** beside it.

## 6. Clean up

To go back to the built-in checklist, delete the installed file:

```sh
rm "$(bb team-onboarding manifest path)"
```

You have installed Team Onboarding, written and installed a manifest, and approved a team command. [The manifest reference](../reference/team-onboarding-manifest.md) lists every section you can add, and [provision a manifest](../how-to/team-onboarding-provision-manifest.md) puts one in place from a bootstrap script.
