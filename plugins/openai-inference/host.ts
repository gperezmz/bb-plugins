// OpenAI-compatible inference's host entry: the server calls it on the
// primary host for every AI task sent to one of its Endpoints.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { contract } from "./src/contract.js";
import { createHandlers } from "./src/handlers.js";

export default experimental_defineHostEntry({
  contract,
  handlers: createHandlers(process.env),
});
