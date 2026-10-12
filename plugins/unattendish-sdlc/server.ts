// Unattendish's backend entry: mounts the command line, bb's thread events and
// the polling service over the fleets the composition root builds.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { compose } from "./src/compose";
import { createFleetCli } from "./src/fleet/adapters/cli";
import { SETTINGS } from "./src/fleet/adapters/settings";

export { SETTINGS };

/** How often the service looks for fleets whose interval has run out. */
const TICK_MS = 5_000;
const PRUNE_EVERY_MS = 3_600_000;

export default async function plugin(bb: BbPluginApi) {
  const fleets = await compose(bb);
  for (const problem of fleets.settingsProblems()) bb.log.warn(`settings: ${problem}`);

  bb.cli.register(createFleetCli(fleets.app));

  bb.events.on("thread.idle", ({ thread }) => fleets.refreshWatched(thread.id));
  bb.events.on("message.dispatched", ({ entry }) => fleets.dispatched(entry.id));

  bb.background.service("poll-fleets", {
    async start(signal) {
      let lastPruned = 0;
      while (!signal.aborted) {
        try {
          await fleets.pollDue();
          if (Date.now() - lastPruned > PRUNE_EVERY_MS) {
            fleets.prune();
            lastPruned = Date.now();
          }
        } catch (error) {
          fleets.warn(`polling failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, TICK_MS);
          signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    },
  });
}
