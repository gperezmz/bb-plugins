// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeeperSettings } from "@/src/server/settings";

let stored: KeeperSettings;
const call = vi.fn(async (method: string, input: unknown) => {
  if (method === "setSettings") stored = { ...stored, ...(input as Partial<KeeperSettings>) };
  return method === "agentTools" ? [] : stored;
});
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call }),
  useRealtime: () => {},
  definePluginApp: (setup: unknown) => setup,
}));

const { default: setup } = (await import("@/app")) as unknown as { default: (app: unknown) => void };

/** The settings sections app.tsx registers, in order. */
function sections(): { title: string; description: string; component: () => React.ReactNode }[] {
  const out: { title: string; description: string; component: () => React.ReactNode }[] = [];
  const noop = () => {};
  setup({ composer: { customize: noop }, contentScripts: { register: noop }, slots: { navPanel: noop, settingsSection: (s: never) => out.push(s) } });
  return out;
}

afterEach(() => {
  cleanup();
  call.mockClear();
});

async function show(title: string) {
  stored = { keepWarm: "switched", checkIns: false, waitMs: 15 * 60_000, fetchPrices: true };
  const Section = sections().find((s) => s.title === title)!.component;
  const { container } = render(<Section />);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return container;
}

/** Each control in the section, top to bottom: its label and its value. */
const controls = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[role=switch], select")].map((c) => {
    const label = document.getElementById(c.getAttribute("aria-labelledby")!)!.textContent;
    return c.tagName === "SELECT" ? `${label}: ${(c as HTMLSelectElement).selectedOptions[0]!.textContent}` : `${label}: ${c.getAttribute("aria-checked") === "true" ? "on" : "off"}`;
  });

describe("the settings page", () => {
  it("shows Waiting threads, Stalled tasks, Prices and Agent tools, in that order, each with its line", () => {
    expect(sections().map((s) => [s.title, s.description])).toEqual([
      ["Waiting threads", "Keeping a waiting thread's prompt cache warm, so coming back to it is cheap."],
      ["Stalled tasks", "Noticing a background command or subagent that has stopped making progress. Separate from keeping caches warm."],
      ["Prices", "Where the dollar figures come from."],
      ["Agent tools", "Tools Claude Code agents may use on their own thread. A change reaches a thread when its session next starts or resumes."],
    ]);
  });

  it("holds Keep caches warm while waiting in Waiting threads, and changes it", async () => {
    const c = await show("Waiting threads");
    expect(controls(c)).toEqual(["Keep caches warm while waiting: Only threads switched on"]);
    await act(async () => fireEvent.change(screen.getByRole("combobox"), { target: { value: "never" } }));
    expect(call).toHaveBeenCalledWith("setSettings", { keepWarm: "never" });
    expect(controls(c)).toEqual(["Keep caches warm while waiting: Never"]);
  });

  it("holds Check on stalled tasks, then No-output wait, in Stalled tasks, with their descriptions, and changes them", async () => {
    const c = await show("Stalled tasks");
    expect(controls(c)).toEqual(["Check on stalled tasks: off", "No-output wait: 15 min"]);
    expect(
      screen.getByText(
        "Ask the agent to check on a background command or subagent that has shown no output or progress for the no-output wait, on every Claude Code thread. While on, the turns that keep caches warm also ask about tasks running 30 minutes or more.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("How long a task goes without output or progress before it counts as stalled. Each further check-in waits twice as long.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Check on stalled tasks" })));
    await act(async () => fireEvent.change(screen.getByRole("combobox", { name: "No-output wait" }), { target: { value: String(30 * 60_000) } }));
    expect(call.mock.calls.filter(([m]) => m === "setSettings").map(([, input]) => input)).toEqual([{ checkIns: true }, { waitMs: 30 * 60_000 }]);
    expect(controls(c)).toEqual(["Check on stalled tasks: on", "No-output wait: 30 min"]);
  });

  it("holds Fetch current prices daily in Prices, and changes it", async () => {
    const c = await show("Prices");
    expect(controls(c)).toEqual(["Fetch current prices daily: on"]);
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Fetch current prices daily" })));
    expect(call).toHaveBeenCalledWith("setSettings", { fetchPrices: false });
  });

  it("says keep-warm nowhere", async () => {
    for (const s of sections()) {
      expect(`${s.title} ${s.description}`).not.toMatch(/keep-warm/i);
      if (s.title === "Agent tools") continue;
      const c = await show(s.title);
      expect(c.textContent).not.toMatch(/keep-warm/i);
      cleanup();
    }
  });
});
