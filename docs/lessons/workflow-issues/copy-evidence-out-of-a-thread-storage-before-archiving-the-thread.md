---
title: Evidence cited from a thread's storage is emptied when the thread is archived
date: 2026-10-25
category: workflow-issues
module: unattendish fleet
problem_type: workflow_issue
component: evidence
severity: medium
applies_when:
  - "A builder or verifier run as a bb thread (a fleet, `implementing`, `verifying-changes`) writes evidence under its thread storage, and a pull request, verdict comment or handover cites it by path"
  - "Archiving the threads of a finished fleet run, or turning on automatic archive in bb's storage retention"
tags: [thread-storage, archive, storage-retention, evidence, verifying-changes, fleet, delete-storage-on-archive, bb-0-47]
retire_when: "bb keeps a thread's storage on archive whatever the retention setting, or the Delete thread storage on archive default changes; check `bb storage retention` and the storage-retention skill of the bb in use"
---

# Evidence cited from a thread's storage is emptied when the thread is archived

Seen on bb 0.47.1, 2026-10-25.

## Context

A fleet's builders and verifiers run as bb threads, and `verifying-changes` keeps its evidence under `$BB_THREAD_STORAGE`, which is `$HOME/.bb/thread-storage/<thread id>/`. Verdict comments on pull requests cite those files by path. The fleet archived its builders, and the folders were left in place but empty: `thr_pzfey7i6gd` and `thr_6nkii6kz8v`, and `thr_rqz4atf78t`, whose `verifier-ac1-list.md` the verdict on #350 cites. The verdict comments of #346, #347, #350 and #357 cite absolute paths in such storage, and #360's cites relative ones and says its evidence is gone (per a check of the comments on 2026-10-25; the operator had named #346 to #360). The decisions comment on #335 records the cost for #360: "their local evidence files were lost when the first builder's thread was archived, and the verdicts rest on the handover's text."

The cause is bb's storage retention plugin, not `bb thread archive` itself. Its **Delete thread storage on archive** setting (`deleteStorageOnArchive`) defaults to off and applies to future manual and automatic archives, cascaded children included. On this machine `bb storage retention` shows it `true`. Cleanup runs after the 30-second undo grace and retries every minute, so the folder is emptied shortly after the archive, not at the moment of it. `bb guide thread-lifecycle` says an archive retires the thread's environment and removes a managed workspace, and says nothing of its storage. Conversations and uploaded attachments are kept, so the thread still reads; only its files go. A thread that is not archived keeps its storage: the fleet manager's evidence folder for #335, on the machine and outside the repository, stayed whole.

## Guidance

- Before archiving a thread whose storage a pull request, verdict comment or handover cites, copy what is cited to storage that outlives the thread, such as the manager's own thread storage, or attach it to the pull request, and cite the new path.
- Run `bb storage retention` on the machine to see whether `deleteStorageOnArchive` is on. Where it is on, assume every archive empties the folder.
- Cite a copy, not the builder's path, in any comment written after the copy exists.

## Why This Matters

A verdict is checked by whoever reads the pull request later. A path that resolves to an empty folder leaves the verdict resting on the author's text, with nothing to re-read or re-run.

## When to Apply

- A fleet or a skill is about to archive its builders, verifiers or review threads.
- A comment is about to cite a file in a thread's storage folder.
- Storage retention or its **Delete thread storage on archive** switch is being turned on or changed.

## Examples

The #335 verifiers' evidence survives as a copy in `$HOME/.bb/thread-storage/thr_mseawp9nnj/fleet/evidence/335/`, the fleet manager's storage (#360's comment still cites the archived `thr_j83qttahkf`, not this copy), while the builders' own folders (`thr_pzfey7i6gd`, `thr_6nkii6kz8v`) are empty.

## Related

- #335 and its [decisions comment](https://github.com/gperezmz/bb-plugins/issues/335#issuecomment-6390685603)
- #346, #347, #350, #357 and #360, whose verdict comments cite paths in the archived threads' storage
