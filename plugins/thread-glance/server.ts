// Thread Glance server: preferences, first-run import, thread stamps, thread
// notes and scheduled sends. The app imports the contract's types from shared/contract.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANNELS, rpcContract } from "./shared/contract";
import { createCli } from "./server/cli";
import { resolveFailureText } from "./server/failures";
import { createBbCliReader, importPreferences } from "./server/import";
import {
  createNoteStore,
  describeDone,
  describeFailure,
  describeInteraction,
  type NoteDraft,
} from "./server/notes";
import { createPreferenceStore } from "./server/preference-store";
import { createScheduledTracker } from "./server/scheduled";
import { createSerialQueue } from "./server/serial";
import { createStampStore } from "./server/stamps";
import { runStartup } from "./server/startup";

export default function threadGlance(bb: BbPluginApi): void {
  const preferences = createPreferenceStore(bb);
  const stamps = createStampStore(bb);
  const notes = createNoteStore(bb);
  const scheduled = createScheduledTracker({
    publish: (signal) => bb.realtime.publish(CHANNELS.scheduled, signal),
  });
  const readBbCli = createBbCliReader(bb.log);
  const importOnce = createSerialQueue();

  bb.rpc.register(rpcContract, {
    async listPreferences() {
      return { preferences: await preferences.readAll() };
    },
    async setPreference({ key, value }) {
      return { key, value: await preferences.write(key, value) };
    },
    async resetPreference({ key }) {
      return { key, value: await preferences.reset(key) };
    },
    importPreferences({ bbMirror }) {
      return importOnce(() =>
        importPreferences({ kv: bb.storage.kv, log: bb.log, store: preferences, readBbCli }, bbMirror),
      );
    },
    async listStamps() {
      return { stamps: await stamps.list() };
    },
    async markSeen({ threadIds }) {
      const at = Date.now();
      await stamps.stamp("seenAt", threadIds, at);
      return { at };
    },
    async clearSeen({ threadIds }) {
      await stamps.clear("seenAt", threadIds);
      return { ok: true as const };
    },
    async listNotes() {
      return { notes: await notes.list() };
    },
    listScheduled() {
      return scheduled.snapshot();
    },
  });

  bb.cli.register(createCli(preferences));

  const note = (draft: NoteDraft, at = Date.now()) => ({ ...draft, at });

  bb.events.on("thread.active", async ({ thread }) => {
    await stamps.stamp("startedAt", [thread.id], Date.now());
    await notes.update(thread.id, { pending: null, failed: null });
  });
  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    await stamps.stamp("finishedAt", [thread.id], Date.now());
    const done = describeDone(lastAssistantText);
    await notes.update(thread.id, { pending: null, ...(done ? { done: note(done) } : {}) });
  });
  bb.events.on("thread.failed", async ({ thread, error }) => {
    await stamps.stamp("finishedAt", [thread.id], Date.now());
    const text = await resolveFailureText(bb, {
      threadId: thread.id,
      error,
      errorInfo: null,
      turnId: null,
    });
    // thread.active clears the failed note, so one that is already here
    // belongs to this failure: turn.failed wrote it first.
    if (text === null && (await notes.get(thread.id))?.failed) return;
    await notes.update(thread.id, { failed: note(describeFailure(text)) });
  });
  // turn.failed carries errorInfo and the turn id. It writes only text that
  // says more than "Failed", in whichever order the two events arrive.
  bb.events.on("turn.failed", async ({ threadId, errorInfo, turnId }) => {
    const text = await resolveFailureText(bb, { threadId, error: null, errorInfo, turnId });
    if (text !== null) await notes.update(threadId, { failed: note(describeFailure(text)) });
  });
  bb.events.on("interaction.pending", async ({ thread, interaction }) => {
    await stamps.stamp("pendingAt", [thread.id], Date.now());
    await notes.update(thread.id, {
      pending: note(describeInteraction(interaction), interaction.createdAt),
    });
  });
  bb.events.on("thread.deleted", async ({ thread }) => {
    scheduled.threadGone(thread.id);
    await stamps.forget([thread.id]);
    await notes.forget([thread.id]);
  });
  bb.events.on("thread.archived", ({ thread }) => scheduled.threadGone(thread.id));
  bb.events.on("message.queued", ({ entry }) => scheduled.queued(entry));
  bb.events.on("message.dispatched", ({ entry }) => scheduled.removed(entry.id));
  bb.events.on("message.cancelled", ({ entry }) => scheduled.removed(entry.id));

  bb.background.service("startup", {
    start: (signal) =>
      runStartup(
        bb,
        [
          { name: "stamps", prune: stamps.prune },
          { name: "notes", prune: notes.prune },
        ],
        scheduled,
        signal,
      ),
  });
}
