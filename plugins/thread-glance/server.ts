// Thread Glance server: preferences, thread stamps, thread
// notes and scheduled sends, served to the app through `sync` and realtime.
// The app imports the RPC contract's types from shared/contract.ts and the
// signals' from shared/signals.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { en } from "zod/locales";
import { config } from "zod/mini";
import { rpcContract } from "./shared/contract";
import { CHANNELS } from "./shared/signals";
import { createCli } from "./server/cli";
import { resolveFailureText } from "./server/failures";
import {
  createNoteStore,
  describeDone,
  describeFailure,
  describeInteraction,
  type NoteChanges,
  type NoteDraft,
} from "./server/notes";
import { createArchivedThreads } from "./server/archived";
import { createPreferenceStore } from "./server/preference-store";
import { createScheduledTracker } from "./server/scheduled";
import { createSerialQueue } from "./server/serial";
import { createStampStore } from "./server/stamps";
import { runStartup } from "./server/startup";
import { createRecordLog } from "./server/sync";
import { createNoteTable, createStampTable, MIGRATIONS } from "./server/thread-table";

export default function threadGlance(bb: BbPluginApi): void {
  // zod/mini carries no messages of its own. The server and CLI show
  // refusals in English, so the locale is set here rather than in the app.
  // Like full zod, it leaves a locale something else in the process set.
  if (config().localeError === undefined) config(en());
  const preferences = createPreferenceStore(bb);
  const db = bb.storage.database();
  bb.storage.migrate(db, [...MIGRATIONS]);
  const stamps = createStampStore(bb, createStampTable(db));
  const notes = createNoteStore(bb, createNoteTable(db));
  const archived = createArchivedThreads();
  const records = createRecordLog(bb, { stamps, notes, archived });
  const scheduled = createScheduledTracker({
    publish: (signal) => bb.realtime.publish(CHANNELS.scheduled, signal),
  });
  // A change to thread records and the signal that carries it, one at a
  // time, so each signal carries the records as its revision left them.
  const inOrder = createSerialQueue();
  /**
   * Runs `write`, which passes the threads each change touched to `changed`,
   * then publishes their records as one signal, even when a later step of
   * `write` fails.
   */
  const changeRecords = (write: (changed: (threadIds: readonly string[]) => void) => Promise<void>) =>
    inOrder(async () => {
      const touched = new Set<string>();
      try {
        await write((threadIds) => {
          for (const threadId of threadIds) touched.add(threadId);
        });
      } finally {
        await records.publish([...touched]);
      }
    });

  bb.rpc.register(rpcContract, {
    async sync({ since }) {
      const [answer, all, sends] = await Promise.all([
        inOrder(() => records.since(since)),
        preferences.readAll(),
        scheduled.snapshot(),
      ]);
      return { ...answer, preferences: all, scheduled: sends };
    },
    fetchArchived({ threadIds }) {
      return inOrder(() => records.fetch(threadIds));
    },
    async setPreference({ key, value }) {
      return { key, value: await preferences.write(key, value) };
    },
    async resetPreference({ key }) {
      return { key, value: await preferences.reset(key) };
    },
    async markSeen({ threadIds }) {
      const at = Date.now();
      await changeRecords(async (changed) => changed(await stamps.stamp("seenAt", threadIds, at)));
      return { at };
    },
    async clearSeen({ threadIds }) {
      await changeRecords(async (changed) => changed(await stamps.clear("seenAt", threadIds)));
      return { ok: true as const };
    },
    async reportIdle({ threadIds }) {
      await changeRecords(async (changed) => changed(await stamps.advance("idleAt", threadIds, Date.now())));
      return { ok: true as const };
    },
  });

  bb.cli.register(createCli(preferences));

  const note = (draft: NoteDraft, at = Date.now()) => ({ ...draft, at });
  // Each event that takes a thread from busy to not busy, as the list counts
  // it, records idleAt here once, whatever the number of windows open.
  const wentIdle = (threadId: string, at: number) => stamps.advance("idleAt", [threadId], at);
  /** Applies note changes to one thread, passing it to `changed` when its notes changed. */
  const updateNotes = async (changed: (threadIds: readonly string[]) => void, threadId: string, changes: NoteChanges) => {
    if (await notes.update(threadId, changes)) changed([threadId]);
  };

  // Each thread event publishes one signal, with every stamp and note it changed.
  bb.events.on("thread.active", ({ thread }) =>
    changeRecords(async (changed) => {
      changed(await stamps.stamp("startedAt", [thread.id], Date.now()));
      await updateNotes(changed, thread.id, { pending: null, failed: null });
    }),
  );
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) =>
    changeRecords(async (changed) => {
      const at = Date.now();
      changed(await stamps.stamp("finishedAt", [thread.id], at));
      changed(await wentIdle(thread.id, at));
      const done = describeDone(lastAssistantText);
      await updateNotes(changed, thread.id, { pending: null, ...(done ? { done: note(done) } : {}) });
    }),
  );
  bb.events.on("thread.failed", async ({ thread, error }) => {
    const at = Date.now();
    const text = await resolveFailureText(bb, {
      threadId: thread.id,
      error,
      errorInfo: null,
      turnId: null,
    });
    await changeRecords(async (changed) => {
      changed(await stamps.stamp("finishedAt", [thread.id], at));
      changed(await wentIdle(thread.id, at));
      // thread.active clears the failed note, so one that is already here
      // belongs to this failure: turn.failed wrote it first.
      if (text === null && (await notes.get(thread.id))?.failed) return;
      await updateNotes(changed, thread.id, { failed: note(describeFailure(text)) });
    });
  });
  // turn.failed carries errorInfo and the turn id. It writes only text that
  // says more than "Failed", in whichever order the two events arrive.
  bb.events.on("turn.failed", async ({ threadId, errorInfo, turnId }) => {
    const text = await resolveFailureText(bb, { threadId, error: null, errorInfo, turnId });
    if (text === null) return;
    await changeRecords((changed) => updateNotes(changed, threadId, { failed: note(describeFailure(text)) }));
  });
  // A thread waiting on the user is not busy, so the list counts this as
  // going idle too.
  bb.events.on("interaction.pending", ({ thread, interaction }) =>
    changeRecords(async (changed) => {
      const at = Date.now();
      changed(await stamps.stamp("pendingAt", [thread.id], at));
      changed(await wentIdle(thread.id, at));
      await updateNotes(changed, thread.id, { pending: note(describeInteraction(interaction), interaction.createdAt) });
    }),
  );
  bb.events.on("thread.deleted", async ({ thread }) => {
    scheduled.threadGone(thread.id);
    archived.unarchive(thread.id);
    await changeRecords(async (changed) => {
      changed(await stamps.forget([thread.id]));
      changed(await notes.forget([thread.id]));
    });
  });
  bb.events.on("thread.archived", ({ thread }) => {
    scheduled.threadGone(thread.id);
    archived.archive(thread.id);
  });
  bb.events.on("thread.unarchived", ({ thread }) => archived.unarchive(thread.id));
  bb.events.on("message.queued", ({ entry }) => scheduled.queued(entry));
  bb.events.on("message.dispatched", ({ entry }) => scheduled.removed(entry.id));
  bb.events.on("message.cancelled", ({ entry }) => scheduled.removed(entry.id));

  /** Runs a prune and publishes the records it dropped, so windows drop them too. */
  const pruneAndPublish = async (prune: () => Promise<string[]>) => {
    let threadIds: string[] = [];
    await changeRecords(async (changed) => {
      threadIds = await prune();
      changed(threadIds);
    });
    return threadIds;
  };

  bb.background.service("startup", {
    start: (signal) => {
      // Reads stamps and notes in, moving 0.7.0's KV rows on the first start
      // after the update, before a window asks. A failure here is retried by
      // the first request that reads them.
      Promise.all([stamps.all(), notes.all()]).catch(() => undefined);
      return runStartup(
        bb,
        [
          { name: "stamps", prune: (live, before) => pruneAndPublish(() => stamps.prune(live, before)) },
          { name: "notes", prune: (live, before) => pruneAndPublish(() => notes.prune(live, before)) },
        ],
        scheduled,
        archived,
        signal,
      );
    },
  });
}
