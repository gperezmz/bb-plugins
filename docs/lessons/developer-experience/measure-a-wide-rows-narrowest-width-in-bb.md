---
title: Measuring the narrowest width of a Fleets page row in bb, to size the switch point
date: 2026-10-13
category: developer-experience
module: plugins/unattendish-sdlc
problem_type: developer_experience
component: Fleets page
severity: medium
applies_when:
  - "the wide layout's queue row gains or loses a column, a button or a label, so the switch point may no longer fit the widest row"
  - "measuring how narrow a plugin's CSS grid row can get, in bb's web UI through a drive"
  - "a cell of a grid row with `truncate`, `min-w-0` or an `auto` track reads wider or narrower at min-content than it draws"
tags: [switch-point, min-content, css-grid, tailwind, layout, driving, headless-chromium, measurement]
---

# Measuring the narrowest width of a Fleets page row in bb, to size the switch point

## Context

The Fleets page draws its wide layout from the switch point up, `SWITCH_POINT_REM` at `plugins/unattendish-sdlc/features/fleets-page/model.ts:60`, sized to the narrowest width of the widest row the wide layout can hold (#277). That width comes from the row's text in bb's own font, so it is measured in a real bb, not summed from the column classes. It took four wrong readings to get there, per this session's measurements, whose printed output the drive's evidence did not keep: the first came from the probe, and the other three each from the row's CSS.

## Guidance

Measure in a `drive-bb-plugins ui` script on the Fleets page: clone the widest real row's grid, make it the widest case (add `not sent`, Re-grant and the unconfirmed icon), set the clone to `width: min-content`, and read its width and each cell's.

- **Keep the clone inside the plugin's subtree**, beside the row it copies (`row.appendChild(clone)`). A clone appended to `document.body` lost the row's grid template, since the plugin's stylesheet scopes its rules under the plugin's root, so every cell read the same 9.797rem and the whole row 9.797rem.
- **Read every cell, not only the total.** A cell reading 0 or its whole text is a fault in the row's CSS, and fixing it changes the switch point:
  - a `truncate` (nowrap) title counts its whole text at min-content, so a long title widens the row without bound. The title keeps 12rem in an inner grid, `grid-cols-[minmax(12rem,max-content)_auto]` (`plugins/unattendish-sdlc/shared/inbox/QueueRow.tsx:87`);
  - the link counted 0 inside a `flex min-w-0` wrapper in an `auto` track, since `min-w-0` on the grid item zeroes that track's minimum. The wrapper is a plain block (`plugins/unattendish-sdlc/shared/ItemLink.tsx:38`) and the link is `w-max max-w-[16rem]` (`QueueRow.tsx:169`);
  - `not sent` broke onto two lines at min-content and counted only `sent`, 1.55rem, until `whitespace-nowrap` (`QueueRow.tsx:92`).
- **Add the page's padding** to the row's width, round up to the next rem, and check the result against the criterion's "1rem narrower breaks". In #277 the widest row was 60.46rem, the padding 3rem, and the switch point 64rem.

## Why This Matters

A wrong measurement still produces a plausible switch point, row and padding together: 46.1rem with the link counting 0, 12.8rem from the clone on `document.body`. A switch point set from either draws the wide row on pages too narrow for it, which is the 0 px title #277 was written to end. jsdom has no layout, so no unit test catches it.

## When to Apply

Whenever the wide row changes what it holds: a new column, a wider button label, a new icon beside the action. Also whenever a criterion bounds a width the page draws and the check has to run in bb.

## Examples

```js
const grid = grantRow.firstElementChild;
const clone = grid.cloneNode(true);
// …append "not sent", a Re-grant button and the unconfirmed icon to the clone's cells…
clone.style.width = "min-content";
clone.style.position = "absolute";
clone.style.visibility = "hidden";
grantRow.appendChild(clone); // not document.body
const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
const cells = [...clone.children].map((cell) => cell.getBoundingClientRect().width / rem);
const rowRem = clone.getBoundingClientRect().width / rem;
clone.remove();
```

## Related

- [Reading React keys from the fiber when a drive of a bb plugin must show "no duplicate key"](read-react-keys-from-the-fiber-when-driving-a-bb-plugin.md): another Fleets page drive where the browser shows something other than what a test would.
- #277, the spec the switch point answers.
