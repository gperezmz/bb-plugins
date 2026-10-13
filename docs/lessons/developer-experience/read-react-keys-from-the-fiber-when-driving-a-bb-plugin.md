---
title: Reading React keys from the fiber when a drive of a bb plugin must show "no duplicate key"
date: 2026-10-13
category: developer-experience
module: plugins/unattendish-sdlc
problem_type: developer_experience
component: Fleets page
severity: low
applies_when:
  - "a criterion says React reports no duplicate key, and the check is a drive of a plugin page in bb's web UI"
  - "a drive's browser console is empty and that is about to be read as the page having no duplicate key"
  - "changing the keys of a list on the Fleets page or the Fleet tab"
tags: [react, keys, duplicate-key, driving, headless-chromium, console, verification]
---

# Reading React keys from the fiber when a drive of a bb plugin must show "no duplicate key"

## Context

#260 told two fleets' Inbox rows apart by adding the fleet to the keys of the Fleets page queue and its Sent list (`rowKey`, `plugins/unattendish-sdlc/shared/inbox/row-model.ts:10`, used at `plugins/unattendish-sdlc/features/fleets-page/Queue.tsx:82` and `:111`). Its criteria say "React reports no duplicate key". The verifier's drive of the real page in headless Chromium logged nothing to the console on the base build, which does have duplicate keys: bb's web UI ships production React, whose fibers carry no `_debug` fields and which does not print the duplicate-key warning (per the verifier's probe in that drive). An empty console proved nothing.

## Guidance

- The check that reads React's own warning is the vitest test, which runs a development build in jsdom: it spies on `console.error` and asserts no call mentions "same key" (`plugins/unattendish-sdlc/features/fleets-page/FleetsPage.test.tsx:558` and `:568`).
- In a driven run, read each list item's key instead: take the DOM node's `__reactFiber$…` property, walk `.return` until a fiber has a non-null `key`, and compare the keys of the list. Distinct keys are the same fact the warning would state. Run the same read on the base build to see it fail, since a probe that cannot fail says nothing.
- Say in the verdict that the keys were read from the fiber and why, since the criterion's own words (a warning in the console) were not what was observed.

## Why This Matters

A drive that reads an empty console as "React reports no duplicate key" passes the base build, which carries the bug, so the verdict could not have come back the other way.

## When to Apply

A criterion about React's own warnings (duplicate keys, invalid DOM nesting, act warnings) checked through a drive of a bb plugin page; the drive sees production React.

## Related

- [#260](https://github.com/gperezmz/bb-plugins/issues/260)
