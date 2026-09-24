import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { homedir } from "node:os";
import { hostContract } from "./src/host/contract.js";
import { resolveRoots } from "./src/host/files.js";
import { createHandlers } from "./src/host/handlers.js";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: createHandlers(resolveRoots(), homedir()),
});
