import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, MAX_POLL_MS, MIN_POLL_MS, nextDelay, TerminalPump, type TerminalIo } from "./terminal-pump.js";

describe("terminal pump", () => {
  it("polls fast while output flows and backs off to 320 ms when idle", () => {
    expect(nextDelay(MAX_POLL_MS, true)).toBe(MIN_POLL_MS);
    let delay = MIN_POLL_MS;
    for (let i = 0; i < 10; i += 1) delay = nextDelay(delay, false);
    expect(delay).toBe(MAX_POLL_MS);
  });

  it("round-trips bytes through base64", () => {
    const bytes = new TextEncoder().encode("héllo ✓");
    expect(new TextDecoder().decode(base64ToBytes(bytesToBase64(bytes)))).toBe("héllo ✓");
  });

  it("replays the tail first, then follows seq, and sends input in order", async () => {
    const calls: unknown[] = [];
    const inputs: string[] = [];
    let seq = 0;
    const io: TerminalIo = {
      async output(args) {
        calls.push(args);
        seq += 1;
        return { chunks: seq < 3 ? [{ dataBase64: btoa(`out${seq}`), seq }] : [], nextSeq: seq, status: seq < 3 ? "running" : "exited", exitCode: seq < 3 ? null : 0, truncated: false };
      },
      async input(args) {
        inputs.push(atob(args.dataBase64));
      },
      async resize() {},
    };
    const written: string[] = [];
    const statuses: string[] = [];
    const pump = new TerminalPump(io, "t1", {
      write: (data) => written.push(new TextDecoder().decode(data)),
      reset: () => {},
      onStatus: (status) => statuses.push(status),
    });
    pump.start();
    pump.send("ls");
    pump.send("\r");
    await new Promise((resolve) => setTimeout(resolve, 400));
    pump.stop();
    expect(calls[0]).toEqual({ terminalId: "t1", tailBytes: 256_000 });
    expect(calls[1]).toEqual({ terminalId: "t1", sinceSeq: 1 });
    expect(written.join("")).toBe("out1out2");
    expect(inputs.join("")).toBe("ls\r");
    expect(statuses).toEqual(["running", "exited"]);
  });
});
