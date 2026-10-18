/** The page's methods over the Endpoint manager. */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { EndpointManager } from "./manage.js";
import { pageContract } from "./page-contract.js";

/**
 * Registers the page's methods.
 *
 * Args:
 *   bb: The plugin's API.
 *   manager: What the methods change the Endpoints through.
 *   notice: What the page says about the Endpoints 0.3 saved, or null.
 */
export function registerPageRpc(bb: BbPluginApi, manager: EndpointManager, notice: () => string | null): void {
  // Another plugin may call any method of this one; only the page, the
  // command and bb itself may change the Endpoints.
  const own = (context: { experimental_caller: { kind: string } }) => {
    if (context.experimental_caller.kind === "plugin") throw new Error("Only the plugin's own page edits its Endpoints.");
  };
  bb.rpc.register(pageContract, {
    endpoints: async (_input, context) => {
      own(context);
      return { endpoints: await manager.list(), notice: notice() };
    },
    saveEndpoint: (input, context) => {
      own(context);
      return manager.save(input.draft, input.create);
    },
    removeEndpoint: (input, context) => {
      own(context);
      return manager.remove(input.id);
    },
  });
}
