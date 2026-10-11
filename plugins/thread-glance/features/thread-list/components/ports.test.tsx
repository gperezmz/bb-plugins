// @vitest-environment jsdom
// The workspace ports on the rows: the port indicator and the Hover card's
// list (AC1), the window's one refresh (AC3), Stop's two presses (AC4) and the
// port link machine (AC5).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortListener } from "@/shared/ports";
import { makeThread } from "@/testing/fixtures";
import { resetRowRenderCounts, rowRenderCounts } from "../testing/fake-host";
import { fakeTimersFromMount, flush, mount, useListHarness } from "../testing/harness";
import { portLinkMachine } from "../storage/port-link-machine";
import { closeHoverCards } from "./rows/hover-state";
import { PORTS_REFRESH_MS } from "../sync/ports-requests";
import { STOP_ARMED_MS } from "./rows/PortsSection";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

useListHarness();

const NOW = Date.now();
const MIN = 60_000;
const fresh = { createdAt: NOW - 5 * MIN, updatedAt: NOW - 5 * MIN, latestAttentionAt: NOW - 5 * MIN };
const anchor = (id: string) => document.querySelector<HTMLElement>(`a[data-sidebar-thread-id="${id}"]`)!;
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card][data-thread-id="${id}"]`)!;
const indicator = (id: string) => card(id).querySelector<HTMLElement>("[data-port-indicator]");
const hoverCard = () => document.querySelector<HTMLElement>("[data-hover-card]")!;

const listener = (patch: Partial<PortListener> = {}): PortListener => ({
  port: 5173,
  address: "127.0.0.1",
  process: "node",
  pid: 4242,
  startedAt: 1_700_000_000_000,
  ownerThreadId: null,
  container: null,
  ...patch,
});

/** A snapshot with `listeners` in the environment `env_main`, on `host_1`. */
const ports = (listeners: PortListener[], hostId = "host_1") => ({ environments: { env_main: { hostId, listeners } } });

beforeEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  closeHoverCards();
  localStorage.clear();
});

/** Keyboard focus, which opens the card at once. */
async function openHover(id: string) {
  fireEvent.keyDown(document.body, { key: "Tab" });
  await act(async () => anchor(id).focus());
  await flush();
}

/** The mounted list once its first ports read has landed. */
async function mountWithPorts(listeners: PortListener[], extra: Partial<Parameters<typeof mount>[0]> = {}, hostId = "host_1") {
  const m = await mount({ threads: [makeThread({ id: "a", title: "Dev server", ...fresh })], server: { ports: ports(listeners, hostId) }, ...extra });
  await waitFor(() => expect(m.server.calls.some((call) => call.method === "ports")).toBe(true));
  await flush();
  return m;
}

describe("AC1: the port indicator and the Hover card's list", () => {
  it("shows the indicator on the card with the count in its name, and lists the listener with its process", async () => {
    await mountWithPorts([listener(), listener({ port: 3000, process: "vite", pid: 9 })]);
    expect(indicator("a")!.getAttribute("aria-label")).toBe("2 workspace ports");
    await openHover("a");
    const section = hoverCard().querySelector<HTMLElement>("[data-section=ports]")!;
    expect(section.textContent).toContain("Workspace ports (2)");
    const entry = within(section).getByText(":5173").closest("li")!;
    expect(entry.textContent).toContain("node");
  });

  it("shows no indicator and no section for an environment without listeners", async () => {
    await mountWithPorts([]);
    expect(indicator("a")).toBeNull();
    await openHover("a");
    expect(hoverCard().querySelector("[data-section=ports]")).toBeNull();
  });

  it("shows it on the folded card, and lists the container's name for a port only Docker reports, without Stop", async () => {
    const m = await mount({
      threads: [makeThread({ id: "a", title: "Dev server", status: "active", runtimeStatus: "active", ...fresh })],
      server: { settings: { compactWorkingThreads: true }, ports: ports([listener({ process: null, pid: null, startedAt: null, container: "web-1" })]) },
    });
    await waitFor(() => expect(m.server.calls.some((call) => call.method === "ports")).toBe(true));
    await flush();
    expect(card("a").getAttribute("data-card")).toBe("folded");
    expect(indicator("a")).not.toBeNull();
    await openHover("a");
    const entry = hoverCard().querySelector<HTMLElement>("[data-port-entry]")!;
    expect(entry.textContent).toContain("web-1");
    expect(within(entry).queryByRole("button")).toBeNull();
  });

  it("scrolls beyond four entries", async () => {
    await mountWithPorts(Array.from({ length: 6 }, (_, index) => listener({ port: 3000 + index, pid: 10 + index })));
    await openHover("a");
    const list = hoverCard().querySelector<HTMLElement>("[data-ports-list]")!;
    expect(list.querySelectorAll("li")).toHaveLength(6);
    // The cap is four entries' height in the same unit, so a fifth entry scrolls.
    const entry = list.querySelector<HTMLElement>("li")!;
    expect(entry.style.height).toBe("calc(var(--spacing) * 6)");
    expect(list.style.maxHeight).toBe("calc(var(--spacing) * 24)");
    expect(list.className).toContain("overflow-y-auto");
  });

  it("follows the snapshot: a listener appearing or going shows or hides the indicator", async () => {
    const m = await mountWithPorts([]);
    await act(async () => m.server.setPorts(ports([listener()])));
    await flush();
    expect(indicator("a")).not.toBeNull();
    await act(async () => m.server.setPorts({ environments: {} }));
    await flush();
    expect(indicator("a")).toBeNull();
  });
});

describe("AC3: the window's refresh", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  it("keeps the indicators when a refresh errors once, and reads fresh when the tab is shown again", async () => {
    const m = await mountWithPorts([listener()]);
    expect(indicator("a")).not.toBeNull();
    setVisibility("hidden");
    m.server.failOnce("ports", "scan failed");
    const before = m.server.calls.filter((call) => call.method === "ports").length;
    await act(async () => setVisibility("visible"));
    await flush();
    const reads = m.server.calls.filter((call) => call.method === "ports");
    expect(reads).toHaveLength(before + 1);
    expect(reads.at(-1)!.input).toEqual({ fresh: true });
    expect(indicator("a")).not.toBeNull();
  });

  it("makes no read while the tab is hidden, however long, and resumes its cadence when it is shown", async () => {
    fakeTimersFromMount();
    const m = await mountWithPorts([listener()]);
    const reads = () => m.server.calls.filter((call) => call.method === "ports").length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS)));
    expect(reads()).toBe(2);
    setVisibility("hidden");
    await act(async () => void (await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS * 5)));
    expect(reads()).toBe(2);
    await act(async () => setVisibility("visible"));
    expect(reads()).toBe(3);
    await act(async () => void (await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS)));
    expect(reads()).toBe(4);
  });

  it("renders no row when only another environment's listeners change", async () => {
    const m = await mount({
      threads: [makeThread({ id: "a", ...fresh }), makeThread({ id: "b", ...fresh, environment: { id: "env_other" } })],
      server: { ports: { environments: { env_main: { hostId: "host_1", listeners: [listener()] } } } },
    });
    await waitFor(() => expect(indicator("a")).not.toBeNull());
    expect(indicator("b")).toBeNull();
    const node = indicator("a");
    resetRowRenderCounts();
    await act(async () =>
      m.server.setPorts({
        environments: {
          env_main: { hostId: "host_1", listeners: [listener()] },
          env_other: { hostId: "host_1", listeners: [listener({ port: 8080 })] },
        },
      }),
    );
    await flush();
    expect(indicator("b")).not.toBeNull();
    expect(indicator("a")).toBe(node);
    expect([...rowRenderCounts().keys()]).toEqual([]);
  });
});

describe("AC4: Stop", () => {
  const owned = listener({ ownerThreadId: "a" });

  it("asks twice: the first press arms it, the second sends the port, PID and start time with the thread", async () => {
    const m = await mountWithPorts([owned]);
    await openHover("a");
    const stop = within(hoverCard()).getByRole("button", { name: "Stop node on port 5173" });
    expect(stop.textContent).toBe("Stop");
    fireEvent.click(stop);
    expect(m.server.calls.some((call) => call.method === "stopPort")).toBe(false);
    const confirm = within(hoverCard()).getByRole("button", { name: "Confirm stopping node on port 5173" });
    expect(confirm.textContent).toBe("Confirm stop");
    await act(async () => void fireEvent.click(confirm));
    await flush();
    expect(m.server.calls.filter((call) => call.method === "stopPort").map((call) => call.input)).toEqual([
      { threadId: "a", port: 5173, pid: 4242, startedAt: 1_700_000_000_000 },
    ]);
    expect(toasts.success).toHaveBeenCalledWith("Stop requested for :5173", expect.anything());
    expect(m.server.calls.filter((call) => call.method === "ports").at(-1)!.input).toEqual({ fresh: true });
  });

  it("expires the armed state after 4 s", async () => {
    const m = await mountWithPorts([owned]);
    await openHover("a");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(within(hoverCard()).getByRole("button", { name: "Stop node on port 5173" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(STOP_ARMED_MS - 1)));
    expect(within(hoverCard()).queryByRole("button", { name: "Confirm stopping node on port 5173" })).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(within(hoverCard()).queryByRole("button", { name: "Confirm stopping node on port 5173" })).toBeNull();
    expect(m.server.calls.some((call) => call.method === "stopPort")).toBe(false);
  });

  it("is disarmed by arming another entry or pressing anywhere else", async () => {
    await mountWithPorts([owned, listener({ port: 3000, pid: 9 })]);
    await openHover("a");
    const section = hoverCard();
    fireEvent.click(within(section).getByRole("button", { name: "Stop node on port 5173" }));
    fireEvent.click(within(section).getByRole("button", { name: "Stop node on port 3000" }));
    expect(within(section).queryByRole("button", { name: "Confirm stopping node on port 5173" })).toBeNull();
    expect(within(section).queryByRole("button", { name: "Confirm stopping node on port 3000" })).not.toBeNull();
    fireEvent.pointerDown(within(section).getByText("Workspace ports (2)"));
    expect(within(section).queryByRole("button", { name: /Confirm stopping/ })).toBeNull();
  });

  it("is disarmed when the button loses focus", async () => {
    await mountWithPorts([owned]);
    await openHover("a");
    fireEvent.click(within(hoverCard()).getByRole("button", { name: "Stop node on port 5173" }));
    fireEvent.blur(within(hoverCard()).getByRole("button", { name: "Confirm stopping node on port 5173" }));
    expect(within(hoverCard()).queryByRole("button", { name: /Confirm stopping/ })).toBeNull();
    expect(within(hoverCard()).queryByRole("button", { name: "Stop node on port 5173" })).not.toBeNull();
  });

  it("offers Stop on a process that nobody owns, and none on a port only Docker reports", async () => {
    await mountWithPorts([listener(), listener({ port: 5432, process: null, pid: null, startedAt: null, container: "db" })]);
    await openHover("a");
    expect(within(hoverCard()).getAllByRole("button", { name: /^Stop / })).toHaveLength(1);
  });

  it("toasts a refusal and a process that has gone", async () => {
    const m = await mountWithPorts([owned]);
    await openHover("a");
    const press = async () => {
      fireEvent.click(within(hoverCard()).getByRole("button", { name: "Stop node on port 5173" }));
      await act(async () => void fireEvent.click(within(hoverCard()).getByRole("button", { name: /Confirm stopping/ })));
      await flush();
    };
    m.server.answer("stopPort", { outcome: "refused" });
    await press();
    expect(toasts.error).toHaveBeenLastCalledWith("Could not stop :5173", { description: "That port is no longer listed for this workspace." });
    m.server.answer("stopPort", { outcome: "gone" });
    await press();
    expect(toasts.error).toHaveBeenLastCalledWith("Could not stop :5173", { description: "The process on it has changed or ended." });
    m.server.failOnce("stopPort", "Server down");
    await press();
    expect(toasts.error).toHaveBeenLastCalledWith("Server down");
  });
});

describe("AC5: the port link machine", () => {
  const link = () => within(hoverCard()).getByText(":5173").closest("a");
  const storedKey = "thread-glance:portLinkMachine";

  it("links nothing by default", async () => {
    await mountWithPorts([listener()]);
    await openHover("a");
    expect(link()).toBeNull();
  });

  it("links a loopback or wildcard port of the chosen machine to 127.0.0.1, in a new tab", async () => {
    await mountWithPorts([listener(), listener({ port: 3000, address: "0.0.0.0", pid: 5 }), listener({ port: 9000, address: "10.0.0.7", pid: 6 })]);
    act(() => portLinkMachine.set("host_1"));
    await openHover("a");
    const first = link()!;
    expect(first.getAttribute("href")).toBe("http://127.0.0.1:5173");
    expect(first.getAttribute("target")).toBe("_blank");
    expect(first.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(hoverCard()).getByText(":3000").closest("a")!.getAttribute("href")).toBe("http://127.0.0.1:3000");
    expect(within(hoverCard()).getByText(":9000").closest("a")).toBeNull();
  });

  it("uses [::1] for a port bound to ::1 only, and https for 443 and 8443", async () => {
    await mountWithPorts([
      listener({ address: "::1" }),
      listener({ port: 443, pid: 5 }),
      listener({ port: 8443, address: "::1", pid: 6 }),
    ]);
    act(() => portLinkMachine.set("host_1"));
    await openHover("a");
    expect(link()!.getAttribute("href")).toBe("http://[::1]:5173");
    expect(within(hoverCard()).getByText(":443").closest("a")!.getAttribute("href")).toBe("https://127.0.0.1:443");
    expect(within(hoverCard()).getByText(":8443").closest("a")!.getAttribute("href")).toBe("https://[::1]:8443");
  });

  it("links nothing for a thread on another machine", async () => {
    await mountWithPorts([listener()], {}, "host_2");
    act(() => portLinkMachine.set("host_1"));
    await openHover("a");
    expect(link()).toBeNull();
  });

  it("is stored on this device, and follows another tab through a storage event", async () => {
    await mountWithPorts([listener()]);
    await openHover("a");
    expect(link()).toBeNull();
    act(() => portLinkMachine.set("host_1"));
    expect(localStorage.getItem(storedKey)).toBe('"host_1"');
    expect(link()).not.toBeNull();
    // Another tab chooses No machine.
    localStorage.removeItem(storedKey);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: storedKey })));
    expect(link()).toBeNull();
    // And chooses a machine again.
    localStorage.setItem(storedKey, '"host_1"');
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: storedKey })));
    expect(link()).not.toBeNull();
    // Another key changes nothing.
    localStorage.setItem(storedKey, '"host_9"');
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "thread-glance:other" })));
    expect(link()).not.toBeNull();
  });

  it("is read from the device when the list opens", async () => {
    localStorage.setItem(storedKey, '"host_1"');
    await mountWithPorts([listener()]);
    await openHover("a");
    expect(link()).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
