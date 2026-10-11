// The end of the plugin's lifetime in a window, which a reload of the app
// brings. Tests load the app once per file, so they end it themselves; it
// imports nothing of bb's runtime, so a test can call it before the app loads.
import { forgetPortsPrompts } from "../commands/ports-prompt";
import { forgetPortLinkMachine } from "../storage/port-link-machine";
import { forgetPluginData } from "./plugin-data";
import { forgetPortsRequests } from "./ports-requests";
import { forgetRequests } from "./requests";

/** Drops everything the plugin's data holds. */
export function endPluginLifetime(): void {
  forgetPortsPrompts();
  forgetPluginData();
  forgetRequests();
  forgetPortsRequests();
  forgetPortLinkMachine();
}
