// Opening a manager thread's Fleet tab from wherever a link to it is drawn.
import { useBbContext, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { requestFleetTab } from "./pending-open";

/** The `threadPanelAction` id the Fleet tab is registered under. */
export const FLEET_TAB_ACTION_ID = "fleet";

/**
 * Opens the Fleet tab of a manager thread. bb opens a panel action only from a thread's
 * own view, so from anywhere else this goes to the thread and leaves a wish for its
 * Fleet chip to take once the thread's header mounts.
 */
export function useOpenFleetTab(): (managerThreadId: string) => void {
  const navigate = useBbNavigate();
  const { threadId: inView } = useBbContext();
  return (managerThreadId) => {
    if (managerThreadId === inView) {
      navigate.openThreadPanel({ actionId: FLEET_TAB_ACTION_ID, params: { threadId: managerThreadId } });
      return;
    }
    requestFleetTab(managerThreadId);
    navigate.toThread(managerThreadId);
  };
}
