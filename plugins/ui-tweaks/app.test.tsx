// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, mountPluginContentScripts, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Tweaks } from "@/shared/tweaks";
import { tweakState } from "@/features/ui-tweaks/state";
import { GRACE_MS } from "@/features/ui-tweaks/contentScript";
import { RETRY_MS } from "@/features/ui-tweaks/components/TweaksSync";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;
let phone = false;

beforeAll(async () => {
  window.matchMedia = ((query: string) => ({
    matches: phone,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  app = await loadPluginApp(() => import("./app"));
});

beforeEach(() => {
  phone = false;
  document.documentElement.style.setProperty("--text-sm", ".8125rem");
  document.documentElement.style.setProperty("--text-sm--line-height", "calc(1.25 / .875)");
  tweakState.set({ textSize: "medium", width: "medium" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
  vi.useRealTimers();
});

function server(initial: Tweaks) {
  let saved = { ...initial };
  return {
    getTweaks: () => saved,
    setTweaks: (patch: unknown) => (saved = { ...saved, ...(patch as Partial<Tweaks>) }),
  };
}

function renderSettings(initial: Tweaks = { textSize: "medium", width: "medium" }) {
  const rpc = server(initial);
  renderSlot(app.appOverlays[0]!, {}, { rpc });
  return renderSlot(app.settingsSections[0]!, {}, { rpc });
}

describe("the plugin's page under Tools", () => {
  it("shows exactly the two rows, Medium chosen on a fresh install", async () => {
    renderSettings();
    const groups = screen.getAllByRole("radiogroup");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Transcript text size", "Transcript width"]);
    expect(screen.getByText("Size of the conversation transcript text.")).toBeTruthy();
    expect(screen.getByText("Maximum width of the transcript and composer columns.")).toBeTruthy();
    expect(within(groups[0]!).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Small", "Medium", "Large"]);
    expect(within(groups[1]!).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Narrow", "Medium", "Wide"]);
    await waitFor(() => {
      expect(screen.getAllByRole("radio", { checked: true }).map((radio) => radio.textContent)).toEqual(["Medium", "Medium"]);
    });
  });

  it("shows the saved choices", async () => {
    renderSettings({ textSize: "large", width: "narrow" });
    await waitFor(() => {
      expect(screen.getAllByRole("radio", { checked: true }).map((radio) => radio.textContent)).toEqual(["Large", "Narrow"]);
    });
  });

  it("saves a choice and highlights it", async () => {
    const slot = renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: "Wide" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Wide" }).getAttribute("aria-checked")).toBe("true"));
    expect(slot.inspection.rpcCalls.at(-1)).toMatchObject({ method: "setTweaks", input: { width: "wide" } });
  });

  it("moves the choice with the arrow keys", async () => {
    const slot = renderSettings();
    await waitFor(() => expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(2));
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Transcript text size" }), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Large" }).getAttribute("aria-checked")).toBe("true"));
    expect(slot.inspection.rpcCalls.at(-1)).toMatchObject({ method: "setTweaks", input: { textSize: "large" } });
  });
});

describe("keeping every window current", () => {
  it("takes a change another window made", async () => {
    const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: server({ textSize: "medium", width: "medium" }) });
    await overlay.behavior.emitRealtime("tweaks", { textSize: "small", width: "wide" });
    expect(tweakState.get()).toEqual({ textSize: "small", width: "wide" });
  });

  it("reads the choices again when a read fails", async () => {
    vi.useFakeTimers();
    let fail = true;
    const rpc = server({ textSize: "large", width: "wide" });
    renderSlot(app.appOverlays[0]!, {}, {
      rpc: {
        ...rpc,
        getTweaks: () => {
          if (fail) throw new Error("server away");
          return rpc.getTweaks();
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(tweakState.get()).toEqual({ textSize: "medium", width: "medium" });
    fail = false;
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(tweakState.get()).toEqual({ textSize: "large", width: "wide" });
  });

  it("reads the choices again after a reconnection", async () => {
    const rpc = server({ textSize: "medium", width: "medium" });
    const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc });
    await overlay.behavior.setRealtimeConnectionState("reconnecting");
    rpc.setTweaks({ textSize: "large" });
    await overlay.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(tweakState.get()).toEqual({ textSize: "large", width: "medium" }));
  });
});

const COLUMN = '<div class="mx-auto max-w-[760px]" style="--md-content-w: 760px;"><p class="text-sm">Hi</p></div>';
const COMPOSER = '<div class="mx-auto max-w-[760px] chat-prompt-box"></div>';

function mountView(html = COLUMN + COMPOSER, attributes: Record<string, string> = {}) {
  const view = document.createElement("div");
  view.setAttribute("data-thread-window", "");
  for (const [name, value] of Object.entries(attributes)) view.setAttribute(name, value);
  view.innerHTML = html;
  document.body.append(view);
  return view;
}

const styleElements = () => [...document.querySelectorAll("style")].filter((style) => style.textContent?.includes("data-thread-window"));

describe("the content script", () => {
  it("adds nothing for Medium and Medium", async () => {
    mountView();
    const scripts = await mountPluginContentScripts(app, { pluginId: "ui-tweaks" });
    expect(styleElements()).toHaveLength(0);
    await scripts.lifecycle.dispose();
  });

  it("applies a change at once and removes everything it added when disabled", async () => {
    mountView();
    const before = document.documentElement.outerHTML;
    const scripts = await mountPluginContentScripts(app, { pluginId: "ui-tweaks" });
    act(() => tweakState.set({ textSize: "large", width: "wide" }));
    expect(styleElements()).toHaveLength(1);
    expect(styleElements()[0]!.textContent).toContain("max-width: 960px");
    act(() => tweakState.set({ textSize: "small", width: "medium" }));
    expect(styleElements()).toHaveLength(1);
    expect(styleElements()[0]!.textContent).not.toContain("max-width");
    await scripts.lifecycle.dispose();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("adds nothing on a phone", async () => {
    phone = true;
    mountView();
    const scripts = await mountPluginContentScripts(app, { pluginId: "ui-tweaks" });
    act(() => tweakState.set({ textSize: "large", width: "wide" }));
    expect(styleElements()).toHaveLength(0);
    await scripts.lifecycle.dispose();
  });
});

describe("a thread view missing a target", () => {
  async function watch() {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scripts = await mountPluginContentScripts(app, { pluginId: "ui-tweaks" });
    return { warn, scripts };
  }

  it("warns once per thread view, naming what is missing, after the grace period", async () => {
    mountView(COLUMN);
    mountView(COMPOSER);
    const { warn, scripts } = await watch();
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(GRACE_MS * 3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toContain("the composer column (.chat-prompt-box.max-w-[760px])");
    expect(warn.mock.calls[1]![0]).toContain("the transcript column");
    await scripts.lifecycle.dispose();
  });

  it("does not warn about a view that finished loading within the grace period", async () => {
    const view = mountView('<div class="max-w-[760px]"></div>');
    const { warn, scripts } = await watch();
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    view.innerHTML = COLUMN + COMPOSER;
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(warn).not.toHaveBeenCalled();
    await scripts.lifecycle.dispose();
  });

  it("stays silent with no thread view, and about another plugin's embedded thread chat", async () => {
    const { warn, scripts } = await watch();
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    mountView('<div class="max-w-none"></div>', { "data-surface-tone": "background" });
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(warn).not.toHaveBeenCalled();
    await scripts.lifecycle.dispose();
  });

  it("warns about a thread view that mounts later", async () => {
    const { warn, scripts } = await watch();
    mountView(COLUMN);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(warn).toHaveBeenCalledTimes(1);
    await scripts.lifecycle.dispose();
  });
});
