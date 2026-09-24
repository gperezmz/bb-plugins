# Approve your team's commands

A team command, plugin source or marketplace in the manifest does nothing until an engineer approves it in the Onboarding page; until then its item shows `needs-approval`. An agent or the CLI cannot approve for you. [Why approvals happen only in the page](../explanation/team-onboarding-checks.md#why-approvals-happen-only-in-the-page) explains the rule.

## Approve

1. Open **Onboarding** in the sidebar.
2. Open the item marked **Needs approval**. Under **Commands from your team** it shows each command, or the plugin or marketplace source, exactly as the manifest has it.
3. Read it. It will run on your machines, as the user bb runs as, with the same access your agents have.
4. Click **Approve**.

To review everything at once, open the **Team manifest** tab: it lists the manifest by section, and each team command and source with **Approve** or **Revoke**.

After approval:

- a team check runs on its next check, scheduled or by **Recheck**;
- a `fix` of kind `run` becomes a fix you can click;
- a `fix` of kind `terminal`, or a tool's `install`, opens a terminal on the machine with the command typed in. Press Enter to run it;
- an approved plugin or marketplace becomes a safe fix, so **Fix all safe items** and `bb team-onboarding apply --safe` install it.

## Revoke

Click **Revoke** beside the command, in the item's row or on the **Team manifest** tab. It stops running, and its item returns to `needs-approval`.

## When approval is asked for again

An approval covers the exact text, its item and the machines it runs on. Changing any of them in the manifest asks for approval again, and a command removed from the manifest loses its approval.
