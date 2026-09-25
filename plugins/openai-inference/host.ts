// OpenAI-compatible inference's host entry: bb calls it on the primary host
// for every helper completion whose BB_INFERENCE names one of its endpoints.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./src/host-contract.js";
import { createHandlers } from "./src/handlers.js";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: createHandlers(),
});
