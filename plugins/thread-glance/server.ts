// Thread Glance server: lifecycle rows, the manual order, the settings and
// the project appearance, served to the app through `sync` and realtime. The
// app imports the RPC contract's types from shared/contract.ts and the
// signals' from shared/signals.ts. `bb thread-glance prefs` edits the settings
// through the same write as the settings page.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { en } from "zod/locales";
import { config } from "zod/mini";
import { rpcContract } from "./shared/contract";
import { applySubsetOrder } from "./shared/manual-order";
import { PROJECT_ICON_ROUTE } from "./shared/project-icon";
import { affectsAutoSettle, type SettingKey } from "./shared/settings";
import { CHANNELS } from "./shared/signals";
import { createLifecycleActions, type ChangeRecords } from "./server/actions";
import { createAppearanceStore } from "./server/appearance-store";
import { createArchiveRelease } from "./server/archive-release";
import { createArchivedThreads } from "./server/archived";
import { createAutoSettle } from "./server/auto-settle";
import { createCli } from "./server/cli";
import { MIGRATIONS } from "./server/database";
import { createLifecycleStore } from "./server/lifecycle-store";
import { createOrderStore } from "./server/order-store";
import { createProjectIcons, createSdkProjectFiles } from "./server/project-icons";
import { createSdkPullRequests } from "./server/pull-requests";
import { createReclaimer } from "./server/reclaim";
import { createRecordLog } from "./server/records";
import { createSdkRuntime } from "./server/runtime";
import { createSerialQueue } from "./server/serial";
import { createSettingsStore } from "./server/settings-store";
import { runStartup } from "./server/startup";
import { createThreadEvents } from "./server/thread-events";
import { createSdkThreads } from "./server/threads";
import { createVersionedChannel } from "./server/versioned";
import { createPortActions } from "./server/ports/actions";
import { createClean } from "./server/ports/clean";
import { createPortsEngine } from "./server/ports/engine";
import { cachedEnvironments, createSdkEnvironments } from "./server/ports/environments";
import { createHoldBack } from "./server/ports/hold-back";
import { createSdkPortsHost } from "./server/ports/host";
import { createPreviewStore } from "./server/ports/preview-store";

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
  const runtime = createSdkRuntime(bb);
  const warn = (message: string) => bb.log.warn(message);
  const portsHost = createSdkPortsHost(bb);
  const portsChannel = createVersionedChannel(bb, CHANNELS.ports, epoch, () => ports.current().snapshot);
  const ports = createPortsEngine({
    threads,
    environments: cachedEnvironments(createSdkEnvironments(bb)),
    host: portsHost,
    publish: (snapshot) => void portsChannel.publish(snapshot),
    warn,
  });
  const portActions = createPortActions({ threads, lifecycle, engine: ports, host: portsHost });
  const clean = createClean({ threads, lifecycle, runtime, engine: ports, host: portsHost, previews: createPreviewStore(db), warn });
  const reclaim = createReclaimer({ lifecycle, threads, runtime, warn });
  const releaseArchived = createArchiveRelease({ threads, runtime, warn });
  const icons = createProjectIcons({ appearance, files: (projectId) => createSdkProjectFiles(bb, projectId), warn });

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

  /** Publishes the settings a write or reset left, and starts the auto-settle pass they call for; unchanged settings publish nothing. */
  const publishSettings = (result: Awaited<ReturnType<typeof settings.write>>) => {
    if (result.changed.length === 0) return settingsChannel.current();
    const published = settingsChannel.publish(result.settings);
    if (affectsAutoSettle(result.changed)) autoSettle.onSettingsChanged(result.changed);
    return published;
  };

  const writeSettings = (patch: unknown) => settingsInOrder(async () => publishSettings(await settings.write(patch)));
  const resetSettings = (keys?: readonly SettingKey[]) => settingsInOrder(async () => publishSettings(await settings.reset(keys)));

  const autoSettle = createAutoSettle({
    lifecycle,
    threads,
    pullRequests: createSdkPullRequests(bb),
    settings,
    heldBack: createHoldBack(ports),
    reclaim,
    change,
    warn,
  });
  const actions = createLifecycleActions({ lifecycle, threads, reclaim, change, warn });
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

    writeSettings: ({ patch }) => writeSettings(patch),
    resetSettings: ({ keys }) => resetSettings(keys),

    async setProjectColour({ projectId, colour }) {
      return appearance.setColour(projectId, colour) ? appearanceChannel.publish(appearance.read()) : appearanceChannel.current();
    },
    async resetProjectColour({ projectId }) {
      return appearance.setColour(projectId, null) ? appearanceChannel.publish(appearance.read()) : appearanceChannel.current();
    },
    async forgetProject({ projectId }) {
      return icons.forget(projectId) ? appearanceChannel.publish(appearance.read()) : appearanceChannel.current();
    },
    async uploadProjectIcon({ projectId, name, dataBase64 }) {
      icons.upload({ projectId, name, dataBase64 });
      return appearanceChannel.publish(appearance.read());
    },
    async clearProjectIcon({ projectId }) {
      return icons.clear(projectId) ? appearanceChannel.publish(appearance.read()) : appearanceChannel.current();
    },

    runAutoSettle: () => autoSettle.run(),

    async ports({ fresh }) {
      await ports.read({ fresh });
      return portsChannel.current();
    },
    stopPort: (input) => portActions.stop(input),
    ownedPorts: ({ threadId }) => portActions.owned(threadId),
    closePorts: (input) => portActions.close(input),
    previewClean: ({ projectIds }) => clean.preview(projectIds),
    runClean: ({ token }) => clean.run(token),
  });

  bb.cli.register(
    createCli({ read: () => settings.read(), write: writeSettings, reset: resetSettings }),
  );

  bb.events.on("thread.created", ({ thread }) => events.created(thread));
  bb.events.on("thread.active", ({ thread }) => events.active(thread));
  bb.events.on("thread.idle", ({ thread }) => events.attention(thread));
  bb.events.on("thread.failed", ({ thread }) => events.attention(thread));
  bb.events.on("interaction.pending", ({ thread }) => events.attention(thread));
  bb.events.on("thread.archived", async ({ thread }) => {
    await events.archived(thread);
    await releaseArchived(thread.id);
  });
  bb.events.on("thread.unarchived", ({ thread }) => events.unarchived(thread));
  bb.events.on("thread.deleted", ({ thread }) => events.deleted(thread));

  bb.http.route("GET", PROJECT_ICON_ROUTE, (context) => icons.serve(context.req.raw));

  bb.background.schedule("auto-settle", "*/5 * * * *", async () => {
    await autoSettle.run();
  });

  bb.background.service("startup", {
    start: (signal) =>
      runStartup(
        { bb, db, threads, lifecycle, order, archived, change, orderChanged: publishOrder },
        signal,
      ),
  });
}
