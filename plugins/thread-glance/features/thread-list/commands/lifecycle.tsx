// The lifecycle commands: snooze, wake now, park, resume, settle, un-settle,
// and the two that clear a row (a dismissed Woke marker, a pinned thread).
// Every entry point (a row's buttons, the slim row's restore button, the
// thread menu) calls these, so the toasts, Undo and refusals are the same.
// A settle ends by offering to close the thread's ports (./ports-prompt), and
// every command on the thread dismisses that offer.
import type { ReactNode } from "react";
import { toast } from "sonner";
import { isBusy } from "@/shared/busy";
import { busyRefusal, type GatedAction } from "@/shared/messages";
import { formatWakeTime } from "@/shared/snooze";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { ActionOutput, Change, RpcContract } from "@/shared/contract";
import { messageOf } from "@/lib/error-message";
import { prefersReducedMotion } from "../model/motion";
import { dismissPortsPrompt, offerToClosePorts } from "./ports-prompt";
import { isCardDrawn, isSweeping, playSweep } from "./sweep";

const SETTLE_TOAST_MS = 4_000;
const RECLAIM_TOAST_MS = 10_000;

export interface LifecycleCommands {
  /** Snoozes the thread until `until` (epoch ms, already resolved in local time). */
  snooze(threadId: string, until: number): Promise<void>;
  wakeNow(threadId: string): Promise<void>;
  park(threadId: string): Promise<void>;
  /** Returns the thread to Active; `quiet` skips the toast, as Undo of a park does. */
  resume(threadId: string, options?: { quiet?: boolean }): Promise<void>;
  /** Plays the sweep when the thread's card is drawn, then settles the thread's whole tree. */
  settle(threadId: string): Promise<void>;
  unsettle(threadId: string): Promise<void>;
  /** Clears the Woke marker of an opened or dismissed thread. */
  dismissWoke(threadId: string): Promise<void>;
  /** Asks the server to clear the row of a pinned thread. */
  clearPinned(threadId: string): Promise<void>;
}

/** The toast body: the line, then what was reclaimed. */
function describe(first: string | null, note: string | null): ReactNode {
  if (first === null && note === null) return undefined;
  return (
    <>
      {first !== null ? <span className="block">{first}</span> : null}
      {note !== null ? <span className="block">{note}</span> : null}
    </>
  );
}

/** What the lifecycle commands need of the window they run in. */
export interface LifecycleHost {
  rpc(): PluginRpcClient<RpcContract>;
  /**
   * The thread as this window sees it, for the client-side gate on a busy
   * thread; null when it is not known, and the server's check stands alone.
   */
  thread(threadId: string): (Parameters<typeof isBusy>[0] & { displayTitle: string }) | null;
}

/** A host for code outside the list: the window's RPC client, and the thread lookup it can offer. */
export function lifecycleHostOf(rpc: PluginRpcClient<RpcContract>, thread: LifecycleHost["thread"] = () => null): LifecycleHost {
  return { rpc: () => rpc, thread };
}

export function createLifecycleCommands(host: LifecycleHost): LifecycleCommands {
  const rpc = host.rpc;
  /** Refuses at once a gated action on a thread this window sees busy; the server checks again. */
  const refuseIfBusy = (action: GatedAction, threadId: string): boolean => {
    const thread = host.thread(threadId);
    if (thread === null || !isBusy(thread)) return false;
    toast.error(busyRefusal(action, thread.displayTitle));
    return true;
  };
  const fail = (error: unknown) => {
    toast.error(messageOf(error));
  };
  /** Undo that puts the changed rows back, and says why a row could not be. */
  const undoChanges = (changes: Change[]) => async () => {
    for (const change of changes) dismissPortsPrompt(change.threadId);
    try {
      const { skipped } = await rpc().call("undoLifecycle", { changes });
      for (const entry of skipped) toast.error(entry.reason);
    } catch (error) {
      fail(error);
    }
  };
  const run = async (call: () => Promise<ActionOutput>): Promise<ActionOutput | null> => {
    try {
      return await call();
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const commands: LifecycleCommands = {
    async snooze(threadId, until) {
      if (refuseIfBusy("snooze", threadId)) return;
      dismissPortsPrompt(threadId);
      const result = await run(() => rpc().call("snooze", { threadId, until }));
      if (result === null) return;
      toast.success("Thread snoozed", {
        description: describe(`Wakes ${formatWakeTime(until, new Date())}`, result.note),
        action: { label: "Undo", onClick: undoChanges(result.changes) },
        ...(result.note !== null ? { duration: RECLAIM_TOAST_MS } : {}),
      });
    },

    async wakeNow(threadId) {
      dismissPortsPrompt(threadId);
      const result = await run(() => rpc().call("wake", { threadId }));
      if (result === null || result.changes.length === 0) return;
      toast.success("Thread woke up", { action: { label: "Undo", onClick: undoChanges(result.changes) } });
    },

    async park(threadId) {
      if (refuseIfBusy("park", threadId)) return;
      dismissPortsPrompt(threadId);
      const result = await run(() => rpc().call("park", { threadId }));
      if (result === null) return;
      toast.success("Thread parked", {
        description: describe(null, result.note),
        action: { label: "Undo", onClick: () => void commands.resume(threadId, { quiet: true }) },
        ...(result.note !== null ? { duration: RECLAIM_TOAST_MS } : {}),
      });
    },

    async resume(threadId, { quiet = false } = {}) {
      dismissPortsPrompt(threadId);
      const result = await run(() => rpc().call("resume", { threadId }));
      if (result === null || quiet) return;
      toast.success("Thread returned to Active", {
        action: { label: "Undo", onClick: () => void commands.park(threadId) },
      });
    },

    async settle(threadId) {
      if (refuseIfBusy("settle", threadId)) return;
      if (isSweeping(threadId)) return;
      dismissPortsPrompt(threadId);
      if (isCardDrawn(threadId) && !prefersReducedMotion()) await playSweep(threadId);
      let result;
      try {
        result = await rpc().call("settle", { threadId });
      } catch (error) {
        fail(error);
        return;
      }
      const { undoToken } = result;
      toast.success("Thread settled", {
        description: describe(null, result.note),
        action: {
          label: "Undo",
          onClick: async () => {
            dismissPortsPrompt(threadId);
            try {
              await rpc().call("undoSettle", { threadId, undoToken });
              toast.success("Settling undone");
            } catch (error) {
              fail(error);
            }
          },
        },
        duration: result.note !== null ? RECLAIM_TOAST_MS : SETTLE_TOAST_MS,
      });
      // After the toast and without waiting: the lookup never holds the settle back.
      void offerToClosePorts(rpc, threadId);
    },

    async unsettle(threadId) {
      dismissPortsPrompt(threadId);
      const result = await run(() => rpc().call("unsettle", { threadId }));
      if (result === null) return;
      toast.success("Thread returned to Active", {
        action: { label: "Undo", onClick: () => void commands.settle(threadId) },
      });
    },

    async dismissWoke(threadId) {
      dismissPortsPrompt(threadId);
      await run(() => rpc().call("dismissWoke", { threadId }));
    },

    async clearPinned(threadId) {
      dismissPortsPrompt(threadId);
      await run(() => rpc().call("clearPinned", { threadId }));
    },
  };
  return commands;
}
