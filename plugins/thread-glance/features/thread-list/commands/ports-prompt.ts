// The prompt after a manual settle: "Close this thread's ports?" with Keep
// open and Close ports, a toast that stays until it is dismissed. One per
// thread and window, outside any list, because the thread menu settles too.
// Any later action on the thread dismisses it, and so does the thread leaving
// Settled, wherever that happens.
import { toast } from "sonner";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CLOSE_PORTS_OUTCOME_TEXT, PORTS_CHECK_FAILED_TEXT } from "@/shared/ports";
import { portList } from "../model/ports";
import { lifecycleRowOf, pluginData } from "../sync";

type Rpc = PluginRpcClient<RpcContract>;

/** Threads whose lookup of owned ports is running; an action on one abandons its prompt. */
const looking = new Set<string>();
/** Threads whose prompt is on screen, with the call that stops watching their row. */
const shown = new Map<string, () => void>();

const toastId = (threadId: string) => `thread-glance-ports-${threadId}`;

/** Dismisses the thread's prompt, or stops its lookup from showing one. Called by every action on the thread. */
export function dismissPortsPrompt(threadId: string): void {
  looking.delete(threadId);
  const unwatch = shown.get(threadId);
  if (unwatch === undefined) return;
  shown.delete(threadId);
  unwatch();
  toast.dismiss(toastId(threadId));
}

/**
 * Dismisses the prompt once the thread's row is no longer Settled, whoever
 * changed it. It first waits to see the row settled, since the settle's
 * signal may not have reached this window when the prompt appears.
 */
function watchSettled(threadId: string): () => void {
  let seenSettled = lifecycleRowOf(threadId)?.settledAt != null;
  return pluginData.subscribe((change) => {
    if (change.kind !== "records" && change.kind !== "synced") return;
    const settled = lifecycleRowOf(threadId)?.settledAt != null;
    if (settled) seenSettled = true;
    else if (seenSettled) dismissPortsPrompt(threadId);
  });
}

/**
 * Looks up the ports the thread owns, after its settle toast is up, and
 * offers to close them. A failed lookup says so; no ports, no prompt.
 */
export async function offerToClosePorts(rpc: () => Rpc, threadId: string): Promise<void> {
  dismissPortsPrompt(threadId);
  looking.add(threadId);
  let owned;
  try {
    const answer = await rpc().call("ownedPorts", { threadId });
    if (!Array.isArray(answer.ports)) throw new Error("malformed answer");
    owned = answer.ports;
  } catch {
    if (looking.delete(threadId)) toast.error(PORTS_CHECK_FAILED_TEXT);
    return;
  }
  // The thread was acted on while the lookup ran.
  if (!looking.delete(threadId) || owned.length === 0) return;
  const id = toastId(threadId);
  const close = async () => {
    dismissPortsPrompt(threadId);
    const targets = owned.map(({ port, pid, startedAt }) => ({ port, pid, startedAt }));
    try {
      const { outcome } = await rpc().call("closePorts", { threadId, ports: targets });
      const text: { title: string; description?: string } = CLOSE_PORTS_OUTCOME_TEXT[outcome];
      if (outcome === "requested") toast.success(text.title, { description: text.description });
      else if (outcome === "partial") toast.error(text.title);
      else toast.info(text.title);
    } catch {
      toast.error(CLOSE_PORTS_OUTCOME_TEXT.failed.title);
    }
  };
  shown.set(threadId, watchSettled(threadId));
  toast.info("Close this thread's ports?", {
    id,
    description: `Stop the processes listening on ${portList(owned.map((entry) => entry.port))}? This also closes any other ports those processes serve.`,
    duration: Infinity,
    // Swiped away, or closed some other way: the row watch goes with the toast.
    onDismiss: () => dismissPortsPrompt(threadId),
    onAutoClose: () => dismissPortsPrompt(threadId),
    cancel: { label: "Keep open", onClick: () => dismissPortsPrompt(threadId) },
    action: { label: "Close ports", onClick: () => void close() },
  });
}

/** Forgets every prompt, as a reload of the app does. For tests. */
export function forgetPortsPrompts(): void {
  for (const unwatch of shown.values()) unwatch();
  shown.clear();
  looking.clear();
}
