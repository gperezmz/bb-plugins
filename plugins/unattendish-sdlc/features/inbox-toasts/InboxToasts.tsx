import { useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { INBOX_NEW } from "@/shared/client";
import { parseInboxNew, toastText } from "./model";

/**
 * Mounted once per bb window as an app overlay. It draws nothing itself: when the server publishes
 * an Inbox row never seen before it raises a toast naming the fleet and the row, which opens the
 * Fleets page. It shows nothing on mount, on reconnect or on reload: only a signal toasts.
 */
export function InboxToasts() {
  const navigate = useBbNavigate();
  useRealtime(INBOX_NEW, (payload) => {
    const signal = parseInboxNew(payload);
    if (signal === null) return;
    // The row's id is the toast's id, so a signal delivered twice raises one toast.
    toast(toastText(signal), { id: signal.rowId, action: { label: "Open Fleets", onClick: () => navigate.toPluginPanel("fleets") } });
  });
  return null;
}
