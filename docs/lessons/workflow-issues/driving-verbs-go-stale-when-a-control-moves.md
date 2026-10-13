---
title: The driving skill's verbs go stale when a plugin's control moves
date: 2026-10-13
category: workflow-issues
module: .agents/skills/driving-bb-plugins
problem_type: workflow_issue
component: driving-bb-plugins
severity: medium
applies_when:
  - "a plugin change moves a button into a menu, renames it, or redraws a radio button as a tile or segment"
  - "a verification drive reports that a driving-bb-plugins verb times out or finds no element, while the user's own path works"
  - "verifying a change to a plugin surface that features/<plugin>.md names by role and accessible name"
tags: [driving, verbs, feature-map, playwright, radio, menu, verification]
---

# The driving skill's verbs go stale when a plugin's control moves

## Context

The build of #259 (pending on branch `bb/259-connect-popup-and-accounts-redesign-thr_ub9bgneem2`, unmerged as of 2026-10-13) moved Unattendish's **Remove account** and **Add token for another owner** from buttons into each account's ⋯ menu. It also redrew the Connect popup's service choice and its credential switch as tiles and segments, each a radio button hidden with `sr-only` inside its `<label>` (`plugins/unattendish-sdlc/shared/connect/ServiceTiles.tsx:18`, `plugins/unattendish-sdlc/shared/connect/TokenStep.tsx:179`). The unit tests were updated and passed. The `driving-bb-plugins` skill's `settings --remove` and `connect --from settings` verbs, however, still pressed those controls with `getByRole("button")`. `connect --service` still called Playwright's `.check()` on the radio. No test runs the verbs, so nothing failed until two verifiers drove the app. One found that the verbs named controls that were no longer buttons, and wrote its own scripts instead. The other saw `.check()` time out, because the label takes the click on a hidden radio.

## Guidance

A change that moves, renames or redraws a control a verb presses changes `verbs/<plugin>.mjs` and `features/<plugin>.md` in the same branch. Run each verb it touched once against a throwaway run before verification is commissioned, so a verifier drives the app rather than the skill.

The verbs now reach controls the way a user does:

- `press` (`.agents/skills/driving-bb-plugins/verbs/unattendish-sdlc.mjs:417`) tries a button by its accessible name. Otherwise it opens each account's `More for <account>` menu in turn and presses the `menuitem` of that name.
- `choose` (`.agents/skills/driving-bb-plugins/verbs/unattendish-sdlc.mjs:409`) clicks a radio's label rather than calling `.check()` on the radio.

## Why This Matters

A stale verb costs a verification drive twice. The verifier either spends its turns writing its own scripts, as the settings verifier of #259's build did, or reports a broken path the user never meets, as the popup verifier did for `connect --service`. Its verdict on the change is then mixed with a verdict on the skill.

## When to Apply

Whenever a diff under a plugin's interface changes the role, accessible name or visibility of a control that `features/<plugin>.md` or `verbs/<plugin>.mjs` names. Search both files for the control's old name before the branch is verified.

## Examples

In #259's build, `drive-bb-plugins unattendish-sdlc settings --remove "Remove GitHub · operator"` would find no button, since the control had become `menuitem "Remove GitHub · operator"` behind `button "More for GitHub · operator"`. `connect "Add account" --from settings --service GitHub` timed out on `.check()` of the GitHub tile's hidden radio.

## Related

- [Driving a plugin flow that sends a token to a service's real host](../developer-experience/drive-a-token-flow-to-a-real-host-behind-a-tls-proxy.md)
- #259, the spec whose build this came from
