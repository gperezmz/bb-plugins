import { ConnectDialog } from "./ConnectDialog";
import { closeConnect, useConnectRequest } from "./requests";

/**
 * Mounted once per bb window as an app overlay: draws the Connect popup for whichever card, toast or settings
 * section asked for it, over the view that is open. Nothing is drawn while no popup was asked for.
 */
export function ConnectOverlay() {
  const asked = useConnectRequest();
  if (asked === null) return null;
  return <ConnectDialog key={asked.serial} request={asked.request} onClose={closeConnect} />;
}
