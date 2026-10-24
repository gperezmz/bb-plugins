---
title: The reorder slide makes rows trail their header when a shelf or group opens or closes
date: 2026-10-24
category: ui-bugs
module: plugins/thread-glance/features/thread-list
problem_type: ui_bug
component: thread-list
severity: medium
symptoms:
  - "Opening or closing a shelf moves the headers below it at once while their rows slide 150 ms behind"
  - "A row slides over a group or worktree header that appeared or vanished in the same render"
  - "A drive or test that samples motion after a toggle reports fewer moving rows than move on screen: rows windowed out, or rows of the other list"
tags: [slide, flip, shelf-toggle, animation, windowing, item-list, worktree-groups]
---

# The reorder slide makes rows trail their header when a shelf or group opens or closes

## Problem

Thread Glance's list slides rows 150 ms (`slideRows` in `plugins/thread-glance/features/thread-list/components/reorder/slide.ts`) to show a reorder. It ran on any change to the list's item order, so a shelf, project group or worktree group opening or closing slid every row below it. The headers, which never slide, jumped to their new place at once and their rows trailed behind (#344).

## Symptoms

- A drive sampling every frame after a toggle, with Settled fully loaded and each pressed header in the middle of the view, found rows of other shelves still moving about ten frames after the press: 37 to 53 across the toggles docked, 42 to 50 undocked.
- Reopening a shelf right after closing it slid nothing: the places were read with `getBoundingClientRect` just after `element.animate` started, so they held the running transform, the old place, and the next delta came out 0.

## What Didn't Work

Each simpler rule broke on a case a later review found:

- **Measuring from the nearest header above in the DOM.** In Project sort a row from a one-thread project is drawn after the previous group's rows, so it was measured from that group's header and slid when the group closed while the next group's header jumped.
- **Sliding only when the rows kept from one render to the next change order.** A row leaving for a closed shelf (snooze, park, settle, archive) only drops a key, so the rows below jumped into the gap instead of sliding.
- **Treating "only group headers came or went, rows in the same order" as a regroup.** It also caught a project group breaking up as its last row moved to the head of the next shelf, which kept the row order; the row has to keep its shelf too.

## Solution

- Every row, project group and worktree group in the list model names the headers it sits under, outermost first (`headers` on `ListItem` in `plugins/thread-glance/features/thread-list/model/list-model.ts`); the row's wrapper carries the innermost as `data-row-header`.
- A row slides only as far as it moved under that header (`slideDelta` in `plugins/thread-glance/features/thread-list/model/reorder.ts`); a row under another header slides from where it was.
- `isToggleOnly` in the same file skips the slide when every item that came or went sits under a shelf or group whose open state changed (or is Load more), or when only group headers came or went around rows that kept their order and shelf.
- Places are read from layout (`offsetTop` in `readRowPlaces`), which ignores a running transform.

## Why This Works

A header never animates, so the only motion that cannot trail it is a row moving with its header. Opening, closing and regrouping only add or drop items around rows that keep their place under their own header, so nothing slides; a real reorder moves a row under its header, or to another, and slides as far as the header did not carry it.

## Prevention

- `plugins/thread-glance/features/thread-list/components/layout.browser.test.tsx` "the slide of rows" records every `element.animate` call on a row while shelves toggle, a row parks into a closed shelf, and a row parks above a group or worktree group; per this session's runs, each failed with its rule broken (the base slide, the slide switched off, rows measured from the list's top, worktree rows given the project group's header).
- Assert motion within one `ItemList`: the sidebar draws Pinned and Active as one list and Working to Settled as another (`plugins/thread-glance/features/thread-list/components/ListBody.tsx`), and a change to one never runs the other's slide, so an assertion across the two passes whatever the code does.
- A drive that samples motion scrolls the pressed header into the middle of the view first: rows outside the view and 240 px around it are spacers, not mounted, so a sweep from the top of a long list measures nothing below: the first undocked sweep from the top counted 11 moving rows where centring the header counted 42 to 50.
- The browser tests' `render` attaches its fake server to the slot (`fake.attach`); without it a lifecycle call such as Park never reaches the list.

## Related

- #344, the issue; #346 added the worktree groups the rule covers.
- [Read React keys from the fiber when driving a bb plugin](../developer-experience/read-react-keys-from-the-fiber-when-driving-a-bb-plugin.md): run the same probe on the base build.
