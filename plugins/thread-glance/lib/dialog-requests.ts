// A request channel from code outside the React tree (a card's menu, bb's
// thread menu) to the one dialog host the app mounts in bb's app overlay
// slot. A bb without that slot mounts no host, so a request nobody hears says
// so instead of doing nothing.
import { useEffect } from "react";
import { toast } from "sonner";

export const NEEDS_APP_OVERLAY = "This action needs bb's app overlay, which this version of bb does not offer.";

export function createDialogRequests<T>() {
  const listeners = new Set<(request: T) => void>();
  return {
    /** Hands `request` to the mounted dialog host, or toasts an error when none is mounted. */
    request(request: T): void {
      if (listeners.size === 0) {
        toast.error(NEEDS_APP_OVERLAY);
        return;
      }
      for (const listener of [...listeners]) listener(request);
    },
    /** Calls `listener` with every request while the caller is mounted. */
    useListener(listener: (request: T) => void): void {
      useEffect(() => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }, [listener]);
    },
  };
}
