// Cache Keeper's host entry: reads Claude Code's transcripts and background
// output on the machine that runs a thread. It keeps nothing between calls
// but the worker's keep-alive lease: the server passes where each read
// stopped and stores what comes back.
import { experimental_defineHostEntry, type ExperimentalHostWorkerLease } from "@get-bb/plugin-sdk/host";
import { onClock } from "./src/core/clock.js";
import { hostContract } from "./src/host/contract.js";
import { commandActivity, readTranscript, resolveRoots, subagentActivity } from "./src/host/files.js";

const roots = resolveRoots();
let lease: { lease: ExperimentalHostWorkerLease; timer: ReturnType<typeof setTimeout> } | null = null;

const release = () => {
  if (lease === null) return;
  clearTimeout(lease.timer);
  void lease.lease.dispose();
  lease = null;
};

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    transcript: ({ sessionId, cursor, jumps }) => readTranscript(roots, sessionId, cursor, (wall) => onClock(jumps, wall)),
    tasks: async ({ sessionId, cwdSlug, commands, subagents, jumps }) => {
      const toClock = (wall: number) => onClock(jumps, wall);
      return {
        commands: await Promise.all(commands.map((id) => commandActivity(roots, cwdSlug, sessionId, id, toClock))),
        subagents: await Promise.all(subagents.map((id) => subagentActivity(roots, cwdSlug, sessionId, id, toClock))),
      };
    },
    retain: ({ ms }, context) => {
      const next = context.experimental_retainWorker();
      release();
      lease = { lease: next, timer: setTimeout(release, ms) };
      return { until: Date.now() + ms };
    },
  },
  dispose: release,
});
