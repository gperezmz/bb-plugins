// Cache Keeper's host entry: reads Claude Code's transcripts and background
// output on the machine that runs a thread.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./src/host/contract.js";
import { commandActivity, resolveRoots, subagentActivity, TranscriptReader } from "./src/host/files.js";

const roots = resolveRoots();
const reader = new TranscriptReader(roots);

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    transcript: ({ sessionId, requestsSince }) => reader.read(sessionId, requestsSince),
    tasks: async ({ sessionId, cwdSlug, commands, subagents }) => ({
      commands: await Promise.all(commands.map((id) => commandActivity(roots, cwdSlug, sessionId, id))),
      subagents: await Promise.all(subagents.map((id) => subagentActivity(roots, cwdSlug, sessionId, id))),
    }),
  },
});
