// Opening a manager thread's Fleet tab from wherever a link to it is drawn.
import { useBbContext, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { requestFleetTab } from "./pending-open";
import { requestReview } from "./review-request";
import { showFleet } from "./shown-fleet";

/** The `threadPanelAction` id the Fleet tab is registered under. */
export const FLEET_TAB_ACTION_ID = "fleet";

/** Which Fleet tab to open: the manager thread's, on `fleet` where one is named, at what needs reviewing with `review`. */
export interface FleetTabTarget {
  readonly managerThreadId: string;
  /** The fleet to show; absent, the tab shows the fleet it last showed for the thread, or its first. */
  readonly fleet?: string;
  /** Open Work at what needs reviewing in `fleet`. */
  readonly review?: boolean;
}

/**
 * Opens the Fleet tab of a manager thread, on the fleet named. The fleet, and Review, travel through the plugin rather
 * than the panel's params, which bb takes for the tab's identity, so the thread's one Fleet tab switches to it. bb opens
 * a panel action only from a thread's own view, so from anywhere else this goes to the thread and leaves a wish for its
 * Fleet chip to take once the thread's header mounts.
 */
export function useOpenFleetTab(): (target: FleetTabTarget) => void {
  const navigate = useBbNavigate();
  const { threadId: inView } = useBbContext();
  return ({ managerThreadId, fleet, review = false }) => {
    if (fleet !== undefined) {
      showFleet(managerThreadId, fleet);
      if (review) requestReview(managerThreadId, fleet);
    }
    if (managerThreadId === inView) {
      navigate.openThreadPanel({ actionId: FLEET_TAB_ACTION_ID, params: { threadId: managerThreadId } });
      return;
    }
    requestFleetTab(managerThreadId);
    navigate.toThread(managerThreadId);
  };
}
