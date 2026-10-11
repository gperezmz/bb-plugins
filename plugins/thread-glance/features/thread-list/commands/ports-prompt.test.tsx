// @vitest-environment jsdom
// AC6: after a manual settle of a thread that owns ports, the toast that offers
// to close them, its four outcomes, and what dismisses it.
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_PORTS_OUTCOME_TEXT, PORTS_CHECK_FAILED_TEXT } from "@/shared/ports";
import { settledRow } from "@/shared/lifecycle";
import { makeThread } from "@/testing/fixtures";
import { flush, mount, useListHarness } from "../testing/harness";
import { attachedListStores } from "../store/list-store";
import { createCommands } from "./commands";
import { createLifecycleCommands, lifecycleHostOf } from "./lifecycle";
import { offerToClosePorts } from "./ports-prompt";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

useListHarness();

const NOW = Date.now();
const fresh = { createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, latestAttentionAt: NOW - 5 * 60_000 };
const OWNED = [
  { port: 5173, pid: 10, startedAt: 111, process: "node" },
  { port: 3000, pid: 11, startedAt: 222, process: null },
];

beforeEach(() => {
  for (const fn of Object.values(toasts)) fn.mockClear();
  // Reduced motion, so a settle does not wait for the sweep.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => vi.unstubAllGlobals());

const settleFromCard = async (title: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Settle ${title}` }));
  });
  await flush();
};
const calls = (m: Awaited<ReturnType<typeof mount>>, method: string) => m.server.calls.filter((call) => call.method === method);
type PromptOptions = { description: string; duration: number; id: string; action: { label: string; onClick(): void }; cancel: { label: string; onClick(): void } };
const prompt = () => {
  const call = toasts.info.mock.calls.find((entry) => entry[0] === "Close this thread's ports?");
  return call === undefined ? undefined : (call[1] as PromptOptions);
};
const press = async (onClick: () => void) => {
  await act(async () => void onClick());
  await flush();
};
/** Commands that run against the fake server as the thread menu's do. */
const menuCommands = (m: Awaited<ReturnType<typeof mount>>) => {
  const handlers = m.server.handlers as unknown as Record<string, (input: unknown) => Promise<unknown>>;
  return createLifecycleCommands(lifecycleHostOf({ call: (method: string, input: unknown) => handlers[method]!(input) } as never));
};

describe("AC6: the prompt after a settle", () => {
  it("stays until dismissed, names the ports and offers Keep open and Close ports, after the settle toast", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
    await settleFromCard("A");
    expect(calls(m, "ownedPorts").map((call) => call.input)).toEqual([{ threadId: "a" }]);
    const options = prompt()!;
    expect(options.description).toBe("Stop the processes listening on :3000, :5173? This also closes any other ports those processes serve.");
    expect(options.duration).toBe(Infinity);
    expect(options.cancel.label).toBe("Keep open");
    expect(options.action.label).toBe("Close ports");
    expect(toasts.success.mock.calls[0]![0]).toBe("Thread settled");
    expect(toasts.success.mock.invocationCallOrder[0]).toBeLessThan(toasts.info.mock.invocationCallOrder[0]!);
  });

  it("does not hold the settle toast back while the lookup runs", async () => {
    let finish!: (value: unknown) => void;
    const m = await mount({
      threads: [makeThread({ id: "a", title: "A", ...fresh })],
      server: { answers: { ownedPorts: () => new Promise((resolve) => (finish = resolve)) } },
    });
    await settleFromCard("A");
    expect(toasts.success.mock.calls[0]![0]).toBe("Thread settled");
    expect(prompt()).toBeUndefined();
    await act(async () => finish({ ports: OWNED }));
    await flush();
    expect(prompt()).toBeDefined();
    expect(calls(m, "ownedPorts")).toHaveLength(1);
  });

  it("closes the looked-up ports on Close ports and says the outcome", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
    await settleFromCard("A");
    await press(prompt()!.action.onClick);
    expect(calls(m, "closePorts").map((call) => call.input)).toEqual([
      {
        threadId: "a",
        ports: [
          { port: 5173, pid: 10, startedAt: 111 },
          { port: 3000, pid: 11, startedAt: 222 },
        ],
      },
    ]);
    expect(toasts.success).toHaveBeenLastCalledWith(CLOSE_PORTS_OUTCOME_TEXT.requested.title, { description: CLOSE_PORTS_OUTCOME_TEXT.requested.description });
  });

  it.each([
    ["partial", "error", CLOSE_PORTS_OUTCOME_TEXT.partial.title],
    ["none", "info", CLOSE_PORTS_OUTCOME_TEXT.none.title],
  ] as const)("reports %s", async (outcome, toastKind, title) => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
    await settleFromCard("A");
    m.server.answer("closePorts", { outcome });
    await press(prompt()!.action.onClick);
    expect(toasts[toastKind]).toHaveBeenLastCalledWith(title);
  });

  it("reports Could not close thread ports when the call fails", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
    await settleFromCard("A");
    m.server.failOnce("closePorts", "boom");
    await press(prompt()!.action.onClick);
    expect(toasts.error).toHaveBeenLastCalledWith(CLOSE_PORTS_OUTCOME_TEXT.failed.title);
  });

  it("says the ports could not be checked when the lookup fails", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })] });
    m.server.failOnce("ownedPorts", "down");
    await settleFromCard("A");
    expect(toasts.error).toHaveBeenCalledWith(PORTS_CHECK_FAILED_TEXT);
    expect(prompt()).toBeUndefined();
  });

  it("offers nothing when the thread owns no ports", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })] });
    await settleFromCard("A");
    expect(calls(m, "ownedPorts")).toHaveLength(1);
    expect(toasts.info).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("offers nothing for an auto-settle", async () => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
    await act(async () => m.server.setRow("a", settledRow(Date.now(), "auto")));
    await flush();
    expect(calls(m, "ownedPorts")).toHaveLength(0);
    expect(toasts.info).not.toHaveBeenCalled();
  });

  it("is dismissed by Keep open", async () => {
    await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
    await settleFromCard("A");
    await press(prompt()!.cancel.onClick);
    expect(toasts.dismiss).toHaveBeenCalledWith(prompt()!.id);
  });

  describe("is dismissed by a later action on the thread", () => {
    const setup = async () => {
      const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
      const commands = menuCommands(m);
      await act(async () => void (await commands.settle("a")));
      await flush();
      expect(prompt()).toBeDefined();
      toasts.dismiss.mockClear();
      return { m, commands, id: prompt()!.id };
    };

    it.each([
      ["un-settle", (c: ReturnType<typeof menuCommands>) => c.unsettle("a")],
      ["snooze", (c: ReturnType<typeof menuCommands>) => c.snooze("a", Date.now() + 3_600_000)],
      ["park", (c: ReturnType<typeof menuCommands>) => c.park("a")],
      ["resume", (c: ReturnType<typeof menuCommands>) => c.resume("a")],
      ["wake", (c: ReturnType<typeof menuCommands>) => c.wakeNow("a")],
      ["dismissWoke", (c: ReturnType<typeof menuCommands>) => c.dismissWoke("a")],
      ["clearPinned", (c: ReturnType<typeof menuCommands>) => c.clearPinned("a")],
    ])("%s", async (_name, act_) => {
      const { commands, id } = await setup();
      await act(async () => void (await act_(commands)));
      expect(toasts.dismiss).toHaveBeenCalledWith(id);
    });

    it("Undo of the settle", async () => {
      const { id } = await setup();
      const settleToast = toasts.success.mock.calls.find((call) => call[0] === "Thread settled")!;
      await act(async () => void (await (settleToast[1] as { action: { onClick(): Promise<void> } }).action.onClick()));
      expect(toasts.dismiss).toHaveBeenCalledWith(id);
    });

    it("the thread leaving Settled elsewhere, such as another window or bb's pin", async () => {
      const { m, id } = await setup();
      await act(async () => m.server.setRow("a", null));
      await flush();
      expect(toasts.dismiss).toHaveBeenCalledWith(id);
    });

    it("a change to another thread's row leaves it", async () => {
      const { m } = await setup();
      await act(async () => m.server.setRow("b", settledRow(Date.now(), "manual")));
      await flush();
      expect(toasts.dismiss).not.toHaveBeenCalled();
    });
  });

  describe("is dismissed by the list's own actions on the thread", () => {
    // The thread is Active, so the prompt can be offered without its row ever being Settled.
    const setup = async () => {
      const m = await mount({
        threads: [makeThread({ id: "a", title: "A", isPinned: true, pinnedAt: NOW, ...fresh }), makeThread({ id: "b", title: "B", ...fresh })],
        server: { answers: { ownedPorts: { ports: OWNED } } },
      });
      const commands = createCommands(attachedListStores()[0]!);
      const handlers = m.server.handlers as unknown as Record<string, (input: unknown) => Promise<unknown>>;
      const rpc = { call: (method: string, input: unknown) => handlers[method]!(input) };
      await act(async () => void (await offerToClosePorts(() => rpc as never, "a")));
      expect(prompt()).toBeDefined();
      toasts.dismiss.mockClear();
      return { m, commands, id: prompt()!.id };
    };

    it.each([
      ["open", (c: ReturnType<typeof createCommands>) => c.open("a")],
      ["rename", (c: ReturnType<typeof createCommands>) => c.rename("a", "Renamed")],
      ["unpin", (c: ReturnType<typeof createCommands>) => c.unpin("a")],
      ["Stop on a port", (c: ReturnType<typeof createCommands>) => c.stopPort("a", { port: 5173, pid: 10, startedAt: 111 })],
      ["a drag", (c: ReturnType<typeof createCommands>) => (c.beginDrag("pinned", "a"), c.cancelDrag())],
      ["Alt+Arrow", (c: ReturnType<typeof createCommands>) => c.moveByKey("a", 1)],
    ])("%s", async (name, act_) => {
      const { commands, id } = await setup();
      await act(async () => void (await act_(commands)));
      // Alt+Arrow on a lone pinned thread is a move that goes nowhere; it is still the person acting on the thread.
      expect(toasts.dismiss, name).toHaveBeenCalledWith(id);
    });
  });

  it.each(["onDismiss", "onAutoClose"] as const)("lets go of the row watch when the toast ends by %s", async (end) => {
    const m = await mount({ threads: [makeThread({ id: "a", title: "A", ...fresh })], server: { answers: { ownedPorts: { ports: OWNED } } } });
    await settleFromCard("A");
    toasts.dismiss.mockClear();
    (prompt() as PromptOptions & Record<typeof end, () => void>)[end]();
    expect(toasts.dismiss).toHaveBeenCalledTimes(1);
    // The watch is gone: the row leaving Settled dismisses nothing more.
    await act(async () => m.server.setRow("a", null));
    await flush();
    expect(toasts.dismiss).toHaveBeenCalledTimes(1);
  });

  it("is not shown when the thread was acted on while the lookup ran", async () => {
    let finish!: (value: unknown) => void;
    const m = await mount({
      threads: [makeThread({ id: "a", title: "A", ...fresh })],
      server: { answers: { ownedPorts: () => new Promise((resolve) => (finish = resolve)) } },
    });
    const commands = menuCommands(m);
    await act(async () => void (await commands.settle("a")));
    await act(async () => void (await commands.unsettle("a")));
    await act(async () => finish({ ports: OWNED }));
    await flush();
    expect(prompt()).toBeUndefined();
  });
});
