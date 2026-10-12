// Unattendish's backend entry: mounts the command line, the dashboard's RPC,
// bb's thread events and the polling service over the fleets the composition
// root builds.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { compose } from "./src/compose";
import { createFleetCli } from "./src/fleet/adapters/cli";
import { rpcContract, rpcHandlers } from "./src/fleet/adapters/rpc";
import { SETTINGS } from "./src/fleet/adapters/settings";

export { rpcContract, SETTINGS };

/** How often the service looks for fleets whose interval has run out. */
const TICK_MS = 5_000;
const PRUNE_EVERY_MS = 3_600_000;

export default async function plugin(bb: BbPluginApi) {
  const fleets = await compose(bb);
  for (const problem of fleets.settingsProblems()) bb.log.warn(`settings: ${problem}`);

  bb.cli.register(createFleetCli(fleets.app));
  bb.rpc.register(rpcContract, rpcHandlers(fleets.dashboard));

  bb.events.on("thread.idle", ({ thread }) => fleets.refreshWatched(thread.id));
  bb.events.on("message.dispatched", ({ entry }) => fleets.dispatched(entry.id));

  bb.background.service("poll-fleets", {
    async start(signal) {
      let lastPruned = 0;
      const running = new Set<Promise<void>>();
      while (!signal.aborted) {
        try {
          // The polls run on; one slow fleet does not hold up the others' next tick.
          const polls = fleets.pollDue().catch((error: unknown) => fleets.failed("polling", error));
          running.add(polls);
          void polls.then(() => running.delete(polls));
          if (Date.now() - lastPruned > PRUNE_EVERY_MS) {
            fleets.prune();
            lastPruned = Date.now();
          }
        } catch (error) {
          fleets.failed("polling", error);
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, TICK_MS);
          signal.addEventListener("abort", done, { once: true });
        });
      }
      await Promise.all(running);
    },
  });
}
