# Team Onboarding

The plugin that shows a live team setup checklist, driven by the team's manifest, on every machine.

## Language

**Item**:
One line of Team Onboarding's checklist: a check, zero or more fixes, and the machines it applies to. Some items are built in; the rest come from the team's manifest.
_Avoid_: Checklist entry, requirement

**Safe fix**:
A fix that is idempotent, needs no input, and runs no code the engineer has not approved. Only safe fixes run from the CLI, from **Fix all safe items**, or through a plugin call.
_Avoid_: Auto-fix, quick fix

**Approval**:
The engineer's recorded consent, given only in the Onboarding page, to run a team command or install from a plugin or marketplace source the manifest names. It is stored per hash of the command or source, its item and its machine rule, so changing any of them needs approval again.
_Avoid_: Trust, allowlist

**Team command**:
A command the manifest names for a machine to run: a check's run or fix command, or a tool's install command. It runs only once approved.
_Avoid_: Custom command, shell command, approved command

**Machine rule**:
Which machines a manifest entry applies to: the server machine, every persistent machine, or a list of machine names. Every item has one, taken from its entry or else from the manifest's top-level machines field.
_Avoid_: Scope, host rule, target
