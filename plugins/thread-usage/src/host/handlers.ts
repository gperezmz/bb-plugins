import { join } from "node:path";
import { readClaudeSession } from "./claude.js";
import { locateCodexSessions, parseCodexFile } from "./codex.js";
import type { LogEntry } from "./contract.js";
import { compareEntries, isDir, isSafeSessionId, type LogRoots } from "./files.js";
import { LogCache } from "./log-cache.js";
import { readPiSession } from "./pi.js";

/** Reads harness session logs on the machine that ran the thread. */
export function createHandlers(roots: LogRoots, home: string) {
  // One per worker; the data directory is the same for every call.
  let cache: LogCache | null = null;
  const cacheFor = (dataDir: string | undefined) => (cache ??= new LogCache(dataDir === undefined ? null : join(dataDir, "log-cache")));
  return {
    probe: async () => {
      const anyDir = async (dirs: string[]) => (await Promise.all(dirs.map(isDir))).some(Boolean);
      return {
        home,
        harnesses: {
          "claude-code": await anyDir(roots.claude),
          pi: await anyDir(roots.pi),
          codex: await anyDir(roots.codex),
        },
      };
    },
    readSessionLogs: async (
      input: {
        harness: "claude-code" | "pi" | "codex";
        sessionIds: string[];
        sinceMs: number | null;
        untilMs: number | null;
        includeSubagents: boolean;
        offset: number;
        limit: number;
      },
      { signal, experimental_paths }: { signal: AbortSignal; experimental_paths?: { dataDir: string } },
    ) => {
      const cache = cacheFor(experimental_paths?.dataDir);
      const window = { sinceMs: input.sinceMs, untilMs: input.untilMs };
      const sessionIds = [...new Set(input.sessionIds)].filter(isSafeSessionId);
      const found = new Set<string>();
      const all: LogEntry[] = [];

      const codexFiles =
        input.harness === "codex"
          ? await locateCodexSessions(roots.codex, sessionIds, signal)
          : null;

      for (const sessionId of sessionIds) {
        signal.throwIfAborted();
        let result: { found: boolean; entries: LogEntry[] };
        if (input.harness === "claude-code") {
          result = await readClaudeSession(
            roots.claude,
            sessionId,
            input.includeSubagents,
            window,
            signal,
            cache,
          );
        } else if (input.harness === "pi") {
          result = await readPiSession(roots.pi, sessionId, window, signal, roots.piBridge, cache);
        } else {
          const files = codexFiles!.get(sessionId) ?? [];
          const entries: LogEntry[] = [];
          for (const path of files) {
            entries.push(...(await parseCodexFile(path, sessionId, window, signal)));
          }
          result = { found: files.length > 0, entries };
        }
        if (result.found) found.add(sessionId);
        all.push(...result.entries);
      }

      all.sort(compareEntries);
      const end = input.offset + input.limit;
      return {
        entries: all.slice(input.offset, end),
        nextOffset: end < all.length ? end : null,
        sessionsFound: [...found],
      };
    },
  };
}
