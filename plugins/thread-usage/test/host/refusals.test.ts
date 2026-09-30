/**
 * Pins what the host entry accepts and refuses on each field of its
 * contract, and the text each refusal carries back to the server, as 0.3.0
 * gave them.
 */
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it } from "vitest";
import { hostContract } from "../../src/host/contract.js";
import { createHandlers } from "../../src/host/handlers.js";

const entry = () =>
  experimental_createHostEntryHarness({
    experimental_apiVersion: 1,
    contract: hostContract,
    handlers: createHandlers({ claude: [], pi: [], piBridge: [], codex: [] }, "/home/demo"),
  });

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => (error as Error).message,
  );

const valid = {
  harness: "claude-code",
  sessionIds: ["claude-sess-1"],
  sinceMs: null,
  untilMs: null,
  includeSubagents: true,
  offset: 0,
  limit: 100,
};

/** For each readSessionLogs field, a value it takes and one it refuses with the text shown. */
const READ: { field: string; accepts: unknown; refuses: unknown; text: string }[] = [
  { field: "harness", accepts: "codex", refuses: "cursor", text: 'Invalid option: expected one of "claude-code"|"pi"|"codex"' },
  { field: "sessionIds", accepts: ["s".repeat(200)], refuses: [], text: "Too small: expected array to have >=1 items" },
  { field: "sessionIds", accepts: Array.from({ length: 64 }, (_, i) => `s${i}`), refuses: Array.from({ length: 65 }, (_, i) => `s${i}`), text: "Too big: expected array to have <=64 items" },
  { field: "sessionIds", accepts: ["s"], refuses: [""], text: "Too small: expected string to have >=1 characters" },
  { field: "sessionIds", accepts: ["s"], refuses: ["s".repeat(201)], text: "Too big: expected string to have <=200 characters" },
  { field: "sinceMs", accepts: 0, refuses: "0", text: "Invalid input: expected number, received string" },
  { field: "untilMs", accepts: 1, refuses: undefined, text: "Invalid input: expected number, received undefined" },
  { field: "includeSubagents", accepts: false, refuses: "yes", text: "Invalid input: expected boolean, received string" },
  { field: "offset", accepts: 0, refuses: -1, text: "Too small: expected number to be >=0" },
  { field: "offset", accepts: 10, refuses: 1.5, text: "Invalid input: expected int, received number" },
  { field: "limit", accepts: 4000, refuses: 4001, text: "Too big: expected number to be <=4000" },
  { field: "limit", accepts: 1, refuses: 0, text: "Too small: expected number to be >0" },
];

describe("host contract input", () => {
  it.each(READ)("readSessionLogs accepts and refuses $field", async ({ field, accepts, refuses, text }) => {
    const h = entry();
    const call = (value: unknown) =>
      h.experimental_call("readSessionLogs", { ...valid, [field]: value } as typeof valid & { harness: "codex" });
    expect(await refusal(call(accepts))).toBeUndefined();
    expect(await refusal(call(refuses))).toBe(text);
  });

  it("readSessionLogs refuses a key the contract does not name", async () => {
    const input = { ...valid, extra: true } as unknown as typeof valid & { harness: "codex" };
    expect(await refusal(entry().experimental_call("readSessionLogs", input))).toBe('Unrecognized key: "extra"');
  });

  it("probe takes null and refuses anything else", async () => {
    const h = entry();
    expect(await refusal(h.experimental_call("probe", null))).toBeUndefined();
    expect(await refusal(h.experimental_call("probe", {} as never))).toBe("Invalid input: expected null, received object");
  });
});
