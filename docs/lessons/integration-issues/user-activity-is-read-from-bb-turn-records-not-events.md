---
title: Telling the user's message from an agent's or a spawn in bb's turn records
date: 2026-10-24
category: integration-issues
module: plugins/thread-glance
problem_type: integration_issue
component: waiting settle
severity: high
symptoms:
  - "A rule meant to react only to the user's own activity in a thread tree fires whenever an agent spawns a thread"
  - "A message the user sends to a thread mid-turn goes unseen until that thread's turn ends"
  - "Unit tests with fake turn records pass while a real bb behaves differently"
tags: [thread-glance, turn-records, initiator, spawn, steer, user-activity, plugin-events, false-green]
retire_when: "bb records who spawned a thread on its turn request, or raises a plugin event for a message steered into a running turn; check the client/turn/requested and plugin event types in the SDK's bundled-types for the bb in use"
---

# Telling the user's message from an agent's or a spawn in bb's turn records

## Problem

Thread Glance's waiting settle (#333) ends when the user acts in the thread tree, and must not end for an agent's turns or for bb's own. Two of bb's behaviours broke the first build. Every spawn reads as the user's in the turn record. A message steered into a running turn raises no plugin event.

## Symptoms

- An orchestrator's subagents ended every waiting settle, because each spawn read as a user's turn.
- A message the user sent to a busy child left the card on "Settling" until the child's turn ended (about 36 s on one tree, per this session's real-bb verifier on 2026-10-24). Every unit and server test passed, since their fakes recorded what the code assumed.

## What Didn't Work

- **Trusting `initiator` and `senderThreadId` for a spawn.** The SDK's `message.dispatch` docs say "A thread-start names its requesting thread", but bb records a spawn from `bb thread spawn --parent-self` as `source: "spawn"`, `initiator: "user"`, `senderThreadId: null`. The thread carries nothing that tells who asked for it either: `originKind`, `originPluginId`, `lifecycleOwnerThreadId` and `sourceThreadId` are all null, and `parentThreadId` says only where the thread sits, which a person sets too.
- **Filtering a spawn's first queued message by its thread's `status === "pending"` alone.** A `message.queued` entry for that message also reads `initiator: "user"` with no sender, and bb can start the child before the check reads it, so the filter missed it (per this session's review, which traced it; no record of plugin events shows it).
- **Waiting for `thread.active` or `message.queued` to read a new message.** A message sent to a thread mid-turn is steered into the running turn, recorded as `client/turn/requested` with `target.kind: "steer"`, but raises neither event (per this session's real-bb verifier; `thread.active` fires only on a transition into `active`, and a steer is no queued row).
- **The `message.dispatch` hook**, rejected before building. It is experimental (`experimental_hooks`) and fail-closed: a handler that throws, or takes past its 10-second box, fails the dispatch it was asked about, any message to any thread.
- **`latestAttentionAt`**, rejected before building. It moves when turns end, a parent notification's included, so it cannot say whose activity it was.

## Solution

The user's own message is the one `client/turn/requested` record with `source: "tell"`, `initiator: "user"`, `senderThreadId: null` and no `retryAttempt` (`toTurnRecord` in `plugins/thread-glance/server/threads.ts`):

```ts
const byUser =
  row.data.source === "tell" && row.data.initiator === "user" && row.data.senderThreadId === null && row.data.retryAttempt === undefined;
```

- **Spawns:** a spawn is no one's. No spawn ends the wait, the user's own included, as #333's decisions comment records.
- **Threads created since the settle:** for a thread created after the settle was chosen, or never run, a queued entry's "user" mark is set aside, and its recorded turns decide.
- **Steered messages:** while a settle waits, every check reads the recorded turns (`bb.sdk.threads.events.list`, via `turnsSince`) of each thread in the tree with a turn in flight, where a steered message lands (`decide` in `plugins/thread-glance/server/waiting-settles.ts`).

## Why This Works

The turn request is the one record whose `source` field separates a typed message (`tell`) from a spawn (`spawn`). An agent's message names its sender in it, and bb's notification turns are `initiator: "system"`. A steered message is still written there as a `tell`, so reading the recorded turns of in-flight threads finds what no event announces.

| Request | `source` | `initiator` | sender thread |
|---|---|---|---|
| A message a person typed (app composer or CLI) | `tell` | `user` | none |
| An agent's message | `tell` | `agent` | named |
| bb's parent notification | `tell` | `system` | none |
| Any spawn, an agent's or the user's | `spawn` | `user` | none |

Per this session's reads of live `bb thread log --json --all` output and its real-bb verifiers' drives on bb 0.47.1, which sent typed messages from both the app composer and `bb thread tell` outside any thread, and spawned threads both as an agent and as the user.

## Prevention

- Before a rule rests on who acted, read the records bb really writes, with `bb thread log <id> --json --all`, for each kind of actor, rather than the SDK's prose.
- Give test fakes the record shapes bb writes, `source` included, as `plugins/thread-glance/server/threads.test.ts` does.
- Drive a real bb for anything that waits on plugin events, since only a drive shows an event bb never raises.

## Related

- #333, and its decisions comment dropping "a child you spawn yourself" from AC3
- #332, the child-question lift the waiting settle builds on
