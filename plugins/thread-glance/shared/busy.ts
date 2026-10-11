// The one rule for whether a thread is busy. The buttons, the server's
// checks, auto-settle and cleanup all call `isBusy`, so they cannot disagree.
// Nothing here imports the SDK: bb's browser thread (`PluginSidebarThread`)
// satisfies `BusyInput` as it is, and the server maps its thread data onto it.

/** Live work counts on a thread; all zero means nothing is running. */
export interface BusyActivity {
  workflows: number;
  backgroundAgents: number;
  backgroundCommands: number;
  planMode: number;
  goals: number;
}

/**
 * What the busy rule reads from a thread. Statuses are plain strings: bb adds
 * values over time and an unknown one reads as not busy.
 */
export interface BusyInput {
  /** A question or approval waits for the user. */
  hasPendingInteraction: boolean;
  /** "waiting": a message is queued; "failed": a queued message failed to send. */
  queuedWork: string;
  /** The thread's execution status. */
  status: string;
  /** The runtime's display status, which refines `status` for machines that are not ready. */
  runtimeStatus: string;
  activity: BusyActivity;
}

/** Statuses of a turn bb has accepted and not finished. */
const TURN_IN_FLIGHT = new Set(["pending", "starting", "active", "stopping"]);
/** Runtime display statuses of a runtime that is up or coming up, a monitor kept alive between turns included. */
const RUNTIME_WORKING = new Set(["provisioning", "starting", "active"]);

/** Whether a turn is in flight. */
export function isTurnInFlight(input: Pick<BusyInput, "status">): boolean {
  return TURN_IN_FLIGHT.has(input.status);
}

/** Whether any activity counter is above zero. */
export function hasActivity(activity: BusyActivity): boolean {
  return (
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0
  );
}

/**
 * Whether the thread is doing work: a turn in flight, an activity counter, or
 * a runtime that is starting, active or provisioning. A pending question or a
 * queued message is not work; `isBusy` adds them.
 */
export function isWorking(input: Omit<BusyInput, "hasPendingInteraction" | "queuedWork">): boolean {
  return isTurnInFlight(input) || RUNTIME_WORKING.has(input.runtimeStatus) || hasActivity(input.activity);
}

/** Whether a message waits to be sent or failed to send. */
export function hasQueuedMessage(input: Pick<BusyInput, "queuedWork">): boolean {
  return input.queuedWork === "waiting" || input.queuedWork === "failed";
}

/**
 * Whether the thread is busy: a pending question or approval, a queued or
 * failed queued message, or work (see `isWorking`). A busy thread cannot be
 * snoozed, parked or settled, is never auto-settled and always sits in Active.
 */
export function isBusy(input: BusyInput): boolean {
  return input.hasPendingInteraction || hasQueuedMessage(input) || isWorking(input);
}
