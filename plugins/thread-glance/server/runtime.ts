// What the server asks bb to do about a thread's agent runtime and terminals,
// for Reclaim and the archive release. `ThreadRuntime` is the port; the SDK
// adapter is the only code here that names `bb.sdk`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** A terminal as Reclaim reads it. */
export interface RuntimeTerminal {
  id: string;
  /** "running" and "starting" are live; a disconnected terminal's process may or may not still exist. */
  status: "disconnected" | "exited" | "running" | "starting";
  /** When anyone last typed into it; null when nobody ever did. */
  lastUserInputAt: number | null;
}

export interface ThreadRuntime {
  /** Stops the thread's work and releases its loaded runtime. */
  stop(threadId: string): Promise<void>;
  /** The thread's terminals, closed ones included. */
  terminals(threadId: string): Promise<RuntimeTerminal[]>;
  /** One terminal as bb has it now; undefined when bb no longer lists it. */
  terminal(terminalId: string): Promise<RuntimeTerminal | undefined>;
  /**
   * Closes a terminal only if nobody has typed into it. Resolves to false when
   * bb refused because someone had, or the terminal is already gone.
   */
  closeIfUntouched(terminalId: string): Promise<boolean>;
  /**
   * Closes a terminal whether or not anyone typed into it. Resolves to false
   * when bb refused or the terminal is already gone.
   */
  closeForce(terminalId: string): Promise<boolean>;
}

export function isLiveTerminal(terminal: Pick<RuntimeTerminal, "status">): boolean {
  return terminal.status === "running" || terminal.status === "starting";
}

type Session = Awaited<ReturnType<BbPluginApi["sdk"]["terminals"]["get"]>>;

const toTerminal = (session: Session): RuntimeTerminal => ({
  id: session.id,
  status: session.status,
  lastUserInputAt: session.lastUserInputAt,
});

export function createSdkRuntime(bb: Pick<BbPluginApi, "sdk">): ThreadRuntime {
  const { terminals, threads } = bb.sdk;
  return {
    async stop(threadId) {
      await threads.stop({ threadId });
    },
    async terminals(threadId) {
      const { sessions } = await terminals.list({ scope: { kind: "thread", threadId } });
      return sessions.map(toTerminal);
    },
    async terminal(terminalId) {
      try {
        return toTerminal(await terminals.get({ terminalId }));
      } catch {
        return undefined;
      }
    },
    async closeIfUntouched(terminalId) {
      try {
        await terminals.close({ terminalId, mode: "if-clean" });
        return true;
      } catch {
        return false;
      }
    },
    async closeForce(terminalId) {
      try {
        await terminals.close({ terminalId, mode: "force" });
        return true;
      } catch {
        return false;
      }
    },
  };
}
