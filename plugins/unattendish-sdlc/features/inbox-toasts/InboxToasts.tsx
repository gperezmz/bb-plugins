import { useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { INBOX_NEW } from "@/shared/client";
import { Glyph, ServiceLogo } from "@/shared/look/Glyph";
import { KIND_ICONS } from "@/shared/look/icons";
import { KIND_TONES } from "@/shared/look/tones";
import { parseInboxNew, toastId, toastLine, toastTitle } from "./model";

/**
 * Mounted once per bb window as an app overlay. It draws nothing itself: when the server publishes an Inbox row never
 * seen before it raises a toast led by the kind's icon, titled by the item, with the fleet's logo and what it waits for
 * under it, which opens the Fleets page. It shows nothing on mount, on reconnect or on reload: only a signal toasts.
 */
export function InboxToasts() {
  const navigate = useBbNavigate();
  // bb draws the toast in its own toaster, outside the plugin's root: these props scope the plugin's styles to it.
  const scope = usePortalScopeProps();
  useRealtime(INBOX_NEW, (payload) => {
    const signal = parseInboxNew(payload);
    if (signal === null) return;
    // The fleet and the row are the toast's id, so a signal delivered twice raises one toast and two fleets' rows two.
    toast(toastTitle(signal), {
      id: toastId(signal),
      icon: (
        <span {...scope}>
          <Glyph name={KIND_ICONS[signal.waitsFor]} tone={KIND_TONES[signal.waitsFor]} className="size-4" />
        </span>
      ),
      description: (
        <span {...scope} className="flex items-center gap-1">
          <ServiceLogo service={signal.forge} />
          {toastLine(signal)}
        </span>
      ),
      action: { label: "Open Fleets", onClick: () => navigate.toPluginPanel("fleets") },
    });
  });
  return null;
}
