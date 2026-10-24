---
title: bb has no "opened" signal for a question that arrives or a failed queued send, so "until you open it" is Thread Glance's own memory
date: 2026-10-25
category: integration-issues
module: plugins/thread-glance
problem_type: integration_issue
component: thread display
severity: medium
symptoms:
  - "A card that should unfold until you open it cannot be told apart from one you have opened by the thread's unread flag, which did not change when its question or approval arrived"
  - "A thread whose queued message failed to send stays a full card after you open it"
  - "A review round fixes one way two windows undo each other's memory of opened threads, and the next round finds another"
tags: [thread-glance, thread-display, is-unread, needs-you, send-failed, per-window-state, over-building, bb-0-47]
retire_when: "bb marks a thread unread when a question or approval arrives, or clears a failed queued send when the thread is opened; check isUnread and the indicator in the plugin SDK's sidebar thread feed (PluginSidebarThread) for a thread that has just been asked, and read the release notes of the bb in use"
---

# bb has no "opened" signal for a question that arrives or a failed queued send, so "until you open it" is Thread Glance's own memory

## Problem

Under **Compact all threads**, a thread that fails or needs you stays a full card "until you open it or the failure or question clears" (#335, AC1). bb offers no "opened" signal for a question, and does not clear a failed queued send on open. The build went looking for one and then built far more memory than the issue asked for: twelve review rounds, and five verifiers per the operator, before the extra memory was reverted.

## Symptoms

- On bb 0.47.1, a question or approval arriving on a thread does not mark it unread: `isUnread` stays as it was. An early build on #335's branch read `isUnread` for "opened", which could not say whether a question had been opened (the plugin's code comment says "bb marks nothing when a question arrives", and the drive in the verifiers' evidence showed a thread read before it asked turning to a full card marked **Needs you**; no `isUnread` value was captured).
- Opening a thread whose queued message failed to send does not clear that state; it clears when the message sends or is deleted (per the fleet manager's decision in #335's decisions comment and the verifiers' brief; the PR #360 verdicts inspected this and did not drive it). The indicator is `queued-failed`, shown as **Send failed**.
- The next build kept the opened questions in the device's storage so they survived a reload and were the same in every window. Rounds eight to twelve each found a new way for two windows to undo each other.

## What Didn't Work

- **Reading `isUnread` for "opened".** It does not move when a question arrives, so it carries nothing about the question.
- **A device-wide, cross-window memory of opened questions** (an `attention-seen` module, later `waits-seen`, with a `seenAttention` and then `seenWaits` storage key, added during #335's review rounds). AC1 reads "until you open it or the failure or question clears", and the issue says nothing of reloads or other windows. The memory had to be kept in step across windows, and rounds eight to twelve each found a new race. The operator had it reverted, and the revert merged with #360.

## Solution

Remember "opened" in each window's own memory, as `questionsSeen` in `plugins/thread-glance/features/thread-list/model/questions-seen.ts` does: the open thread is added while its question waits, and every thread that no longer asks is dropped, so its next question unfolds it again. A reload or another window shows an opened question as a full card until it clears; the **Compact all threads** row in `docs/reference/thread-glance-list.md` says an opened question "stays folded in that window only". A queued send failure stays a full card until it sends or is deleted, opened or not, and the same row says that too.

## Why This Works

bb has no flag that means "the user has seen this question" (as far as the plugin's behaviour on 0.47.1 shows), so any "opened" has to be the plugin's own. Keeping it in one window's memory needs no agreement between windows, so there is nothing for two of them to undo. The cost, a question that shows full again after a reload, is the one #335 accepted.

## Prevention

- Before a rule rests on bb's unread flag or on a state clearing when a thread is opened, make the change happen on a real bb and read `isUnread` and the indicator as the plugin SDK's sidebar thread feed gives them (`PluginSidebarThread`); `bb thread show --json` carries neither, only `lastReadAt` and `latestAttentionAt`. A plugin's fakes record what the code assumes.
- Remember "opened" per window. Carry it across reloads or windows only where an issue asks for that, since keeping it in step across windows is where #335's rounds went.
- When review rounds keep finding new ways a design breaks, ask whether the design is what the issue asked for before the next round.

## Related

- #335 and its [decisions comment](https://github.com/gperezmz/bb-plugins/issues/335#issuecomment-6390685603)
- #360, which merged Compact all threads with the revert
- [Telling the user's message from an agent's or a spawn in bb's turn records](user-activity-is-read-from-bb-turn-records-not-events.md): another bb signal that does not mean what its name suggests
