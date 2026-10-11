// Thread Glance server: lifecycle rows, the manual order, the settings and
// the project appearance, served to the app through `sync` and realtime. The
// app imports the RPC contract's types from shared/contract.ts and the
// signals' from shared/signals.ts.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { en } from "zod/locales";
import { config } from "zod/mini";
import { rpcContract } from "./shared/contract";
import { applySubsetOrder } from "./shared/manual-order";
import { affectsAutoSettle } from "./shared/settings";
import { CHANNELS } from "./shared/signals";
import { createLifecycleActions, type ChangeRecords } from "./server/actions";
import { createAppearanceStore } from "./server/appearance-store";
import { createArchivedThreads } from "./server/archived";
import { createAutoSettle } from "./server/auto-settle";
import { MIGRATIONS } from "./server/database";
import { createLifecycleStore } from "./server/lifecycle-store";
import { notImplemented } from "./server/not-implemented";
import { createOrderStore } from "./server/order-store";
import { createReclaimer } from "./server/reclaim";
import { createRecordLog } from "./server/records";
import { createSerialQueue } from "./server/serial";
import { createSettingsStore } from "./server/settings-store";
import { runStartup } from "./server/startup";
import { createThreadEvents } from "./server/thread-events";
import { createSdkThreads } from "./server/threads";
import { createVersionedChannel } from "./server/versioned";

export default function threadGlance(bb: BbPluginApi): void {
  // zod/mini carries no messages of its own. The server shows refusals in
  // English, so the locale is set here rather than in the app. Like full zod,
  // it leaves a locale something else in the process set.
  if (config().localeError === undefined) config(en());
  const db = bb.storage.database();
  bb.storage.migrate(db, [...MIGRATIONS]);
  const lifecycle = createLifecycleStore(db);
  const order = createOrderStore(db);
  const appearance = createAppearanceStore(db);
  const settings = createSettingsStore(bb);
  const archived = createArchivedThreads();
  const epoch = randomUUID();
  const records = createRecordLog(bb, { lifecycle, archived }, epoch);
  const settingsChannel = createVersionedChannel(bb, CHANNELS.settings, epoch, () => settings.read());
  const orderChannel = createVersionedChannel(bb, CHANNELS.order, epoch, () => [...order.get()]);
  const appearanceChannel = createVersionedChannel(bb, CHANNELS.appearance, epoch, () => appearance.read());
  const threads = createSdkThreads(bb);
  const autoSettle = createAutoSettle();

  // A change to thread records and the signal that carries it, one at a
  // time, so each signal carries the records as its revision left them.
  const inOrder = createSerialQueue();
  /**
   * Runs `write`, which passes the threads each change touched to `changed`,
   * then publishes their records as one signal, even when a later step of
   * `write` fails.
   */
  const change: ChangeRecords = (write) =>
    inOrder(async () => {
      const touched = new Set<string>();
      try {
        return await write((threadIds) => {
          for (const threadId of threadIds) touched.add(threadId);
        });
      } finally {
        records.publish([...touched]);
      }
    });
  const publishOrder = () => void orderChannel.publish([...order.get()]);
  // Settings edits read the record, change it and store it: one at a time.
  const settingsInOrder = createSerialQueue();

  const actions = createLifecycleActions({
    lifecycle,
    threads,
    reclaim: createReclaimer(),
    change,
    warn: (message) => bb.log.warn(message),
  });
  const events = createThreadEvents({ lifecycle, order, orderChanged: publishOrder, archived, threads, change });

  bb.rpc.register(rpcContract, {
    async sync({ since }) {
      const answer = await inOrder(() => records.since(since));
      const [settingsNow, orderNow, appearanceNow] = await Promise.all([
        settingsChannel.current(),
        orderChannel.current(),
        appearanceChannel.current(),
      ]);
      return { ...answer, settings: settingsNow, order: orderNow, appearance: appearanceNow };
    },

    snooze: ({ threadId, until }) => actions.snooze(threadId, until),
    wake: ({ threadId }) => actions.wake(threadId),
    park: ({ threadId }) => actions.park(threadId),
    resume: ({ threadId }) => actions.resume(threadId),
    settle: ({ threadId }) => actions.settle(threadId),
    undoSettle: ({ threadId, undoToken }) => actions.undoSettle(threadId, undoToken),
    unsettle: ({ threadId }) => actions.unsettle(threadId),
    undoLifecycle: ({ changes }) => actions.undoLifecycle(changes),
    dismissWoke: ({ threadId }) => actions.dismissWoke(threadId),
    clearPinned: ({ threadId }) => actions.clearPinned(threadId),

    async reorder({ threadIds }) {
      order.replace(applySubsetOrder(order.get(), threadIds));
      return orderChannel.publish([...order.get()]);
    },

    writeSettings: ({ patch }) =>
      settingsInOrder(async () => {
        const result = await settings.write(patch);
        if (result.changed.length === 0) return settingsChannel.current();
        const published = settingsChannel.publish(result.settings);
        if (affectsAutoSettle(result.changed)) autoSettle.onSettingsChanged(result.changed);
        return published;
      }),
    resetSettings: ({ keys }) =>
      settingsInOrder(async () => {
        const result = await settings.reset(keys);
        if (result.changed.length === 0) return settingsChannel.current();
        const published = settingsChannel.publish(result.settings);
        if (affectsAutoSettle(result.changed)) autoSettle.onSettingsChanged(result.changed);
        return published;
      }),

    async setProjectColour({ projectId, colour }) {
      return appearance.setColour(projectId, colour) ? appearanceChannel.publish(appearance.read()) : appearanceChannel.current();
    },
    async resetProjectColour({ projectId }) {
      return appearance.setColour(projectId, null) ? appearanceChannel.publish(appearance.read()) : appearanceChannel.current();
    },
    async forgetProject({ projectId }) {
      return appearance.forget(projectId) ? appearanceChannel.publish(appearance.read()) : appearanceChannel.current();
    },
    uploadProjectIcon: notImplemented("uploadProjectIcon", "project icons"),
    clearProjectIcon: notImplemented("clearProjectIcon", "project icons"),

    runAutoSettle: () => autoSettle.run(),
  });

  bb.events.on("thread.created", ({ thread }) => events.created(thread));
  bb.events.on("thread.active", ({ thread }) => events.active(thread));
  bb.events.on("thread.idle", ({ thread }) => events.attention(thread));
  bb.events.on("thread.failed", ({ thread }) => events.attention(thread));
  bb.events.on("interaction.pending", ({ thread }) => events.attention(thread));
  bb.events.on("thread.archived", ({ thread }) => events.archived(thread));
  bb.events.on("thread.unarchived", ({ thread }) => events.unarchived(thread));
  bb.events.on("thread.deleted", ({ thread }) => events.deleted(thread));

  bb.background.service("startup", {
    start: (signal) =>
      runStartup(
        { bb, db, threads, lifecycle, order, archived, change, orderChanged: publishOrder },
        signal,
      ),
  });
}
