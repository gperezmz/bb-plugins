import { useRealtime } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { FLEET_NEEDS } from "@/shared/client";
import { openConnect } from "@/shared/connect/requests";
import { parseFleetNeeds, toastId } from "./model";

/**
 * Mounted once per bb window as an app overlay. It draws nothing itself: when the server publishes that a
 * fleet newly needs an account it raises a toast saying what it needs, whose Connect… opens the popup over
 * the view that is open.
 */
export function NeedsToasts() {
  useRealtime(FLEET_NEEDS, (payload) => {
    const signal = parseFleetNeeds(payload);
    if (signal === null) return;
    toast(signal.text, { id: toastId(signal), action: { label: "Connect…", onClick: () => openConnect({ target: { fleet: signal.fleet, role: signal.role } }) } });
  });
  return null;
}
