import { useRealtime } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { FLEET_NEEDS } from "@/shared/client";
import { openConnect } from "@/shared/connect/requests";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { parseFleetNeeds, toastAction, toastDescription, toastId, toastTitle } from "./model";

/**
 * Mounted once per bb window as an app overlay. It draws nothing itself: when the server publishes that a fleet newly
 * needs an account it raises a toast led by a red plug, saying the fleet can't be read and, under that, what it needs,
 * whose Connect… opens the popup over the view that is open. A token refused because it has expired is led by a red
 * key instead, says it expired, and offers Renew… for it.
 */
export function NeedsToasts() {
  // bb draws the toast in its own toaster, outside the plugin's root: these props scope the plugin's styles to it.
  const scope = usePortalScopeProps();
  useRealtime(FLEET_NEEDS, (payload) => {
    const signal = parseFleetNeeds(payload);
    if (signal === null) return;
    const action = toastAction(signal);
    toast(toastTitle(signal), {
      id: toastId(signal),
      icon: (
        <span {...scope}>
          <Glyph name={signal.expired === null ? ICONS.connect : ICONS.renew} tone="red" className="size-4" />
        </span>
      ),
      description: toastDescription(signal, new Date().toISOString()),
      action: { label: action.label, onClick: () => openConnect(action.request) },
    });
  });
  return null;
}
