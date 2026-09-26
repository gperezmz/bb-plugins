// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  // jsdom lacks these; Radix uses them.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  app = await loadPluginApp(() => import("./app"));
});

afterEach(cleanup);

function item(
  id: string,
  label: string,
  action: ExperimentalSidebarNavigationItem["action"],
  overrides: Partial<ExperimentalSidebarNavigationItem> = {},
): ExperimentalSidebarNavigationItem {
  return {
    id,
    label,
    icon: { kind: "plugin", pluginId: id.split("/")[0], icon: null },
    action,
    isDisabled: false,
    isVisible: true,
    isLoading: false,
    pluginId: null,
    shortcut: null,
    experimental_Accessory: null,
    ...overrides,
  };
}

const NEW_THREAD = item("__bb__/new-thread", "New thread", { kind: "new-thread" });
const SEARCH = item("__bb__/search-threads", "Search", { kind: "search-threads" });
const PLUGINS = item("__bb__/extensions", "Plugins", { kind: "open-extensions" });
const AUTOMATIONS = item("automations/automations", "Automations", {
  kind: "open-plugin-panel",
  pluginId: "automations",
  panelId: "automations",
});
const USAGE = item("usage/usage", "Usage", { kind: "open-plugin-panel", pluginId: "usage", panelId: "usage" });
const THREAD_USAGE = item("thread-usage/thread-usage", "Thread usage", {
  kind: "open-plugin-panel",
  pluginId: "thread-usage",
  panelId: "thread-usage",
});
const hidden = (entry: ExperimentalSidebarNavigationItem) => ({ ...entry, isVisible: false });

function BbNavigation() {
  return <div>bb's own navigation</div>;
}

function render(
  items: readonly ExperimentalSidebarNavigationItem[],
  { isCompactViewport = true, activeItemId = null as string | null } = {},
): RenderedSlot {
  const [registration] = app.experimentalSidebarNavigations;
  return renderSlot(
    registration,
    { isCompactViewport, experimental_Original: BbNavigation },
    { sidebarNavigation: { items, activeItemId } },
  );
}

const navigation = () => screen.getByRole("navigation", { name: "Sidebar navigation" });
const buttonNames = () =>
  within(navigation())
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
const activated = (slot: RenderedSlot) =>
  slot.inspection.sidebarNavigationCalls.filter((call) => call.method === "activate").map((call) => call.itemId);

// On a phone "…" opens bb's bottom drawer, which draws its items a frame later.
function openOverflow() {
  fireEvent.click(screen.getByRole("button", { name: "More sidebar navigation" }));
  return screen.findAllByRole("menuitem");
}

describe("Pocket Navigation", async () => {
  it("registers as a sidebar navigation named Pocket Navigation", () => {
    expect(app.experimentalSidebarNavigations.map((slot) => [slot.id, slot.title])).toEqual([
      ["pocket-navigation", "Pocket Navigation"],
    ]);
  });

  it("draws bb's own navigation where bb does not report a phone", () => {
    render([NEW_THREAD, SEARCH, PLUGINS], { isCompactViewport: false });
    expect(screen.getByText("bb's own navigation")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Sidebar navigation" })).toBeNull();
  });

  it("draws the icon row in bb's order, then the New thread line with search at its right", () => {
    render([PLUGINS, NEW_THREAD, AUTOMATIONS, SEARCH, USAGE, THREAD_USAGE]);
    expect(screen.queryByText("bb's own navigation")).toBeNull();
    expect(buttonNames()).toEqual(["Plugins", "Automations", "Usage", "Thread usage", "New thread", "Search"]);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("gives each icon its entry's label as its name and activates that entry", () => {
    const slot = render([NEW_THREAD, SEARCH, PLUGINS, USAGE]);
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(activated(slot)).toEqual(["usage/usage", "__bb__/extensions", "__bb__/new-thread", "__bb__/search-threads"]);
  });

  it("has no … when nothing is hidden", () => {
    render([NEW_THREAD, SEARCH, PLUGINS]);
    expect(screen.queryByRole("button", { name: "More sidebar navigation" })).toBeNull();
  });

  it("lists every hidden entry behind …, in bb's order, then Customize sidebar", async () => {
    const slot = render([hidden(USAGE), NEW_THREAD, hidden(SEARCH), PLUGINS, hidden(AUTOMATIONS)]);
    expect(buttonNames()).toEqual(["Plugins", "More sidebar navigation", "New thread"]);
    const menu = (await openOverflow());
    expect(menu.map((entry) => entry.textContent)).toEqual(["Usage", "Search", "Automations", "Customize sidebar"]);
    fireEvent.click(menu[1]);
    expect(activated(slot)).toEqual(["__bb__/search-threads"]);
  });

  it("opens bb's customize editor from …", async () => {
    const slot = render([NEW_THREAD, hidden(USAGE)]);
    fireEvent.click((await openOverflow()).at(-1)!);
    expect(slot.inspection.sidebarNavigationCalls.map((call) => call.method)).toEqual(["openCustomize"]);
  });

  it("puts a hidden New thread behind … and leaves search alone on its line", async () => {
    render([hidden(NEW_THREAD), SEARCH, PLUGINS]);
    expect(buttonNames()).toEqual(["Plugins", "More sidebar navigation", "Search"]);
    expect((await openOverflow()).map((entry) => entry.textContent)).toEqual(["New thread", "Customize sidebar"]);
  });

  it("draws no New thread line when New thread and search are both hidden", () => {
    render([hidden(NEW_THREAD), hidden(SEARCH), PLUGINS]);
    expect(buttonNames()).toEqual(["Plugins", "More sidebar navigation"]);
  });

  it("marks the entry bb reports as active wherever it is drawn", async () => {
    render([NEW_THREAD, SEARCH, PLUGINS, USAGE], { activeItemId: "usage/usage" });
    expect(screen.getByRole("button", { name: "Usage" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Plugins" }).getAttribute("aria-current")).toBeNull();
    cleanup();

    render([NEW_THREAD, SEARCH, hidden(USAGE)], { activeItemId: "usage/usage" });
    const usage = (await openOverflow()).find((entry) => entry.textContent === "Usage")!;
    expect(within(usage).getByText("Usage").getAttribute("aria-current")).toBe("page");
    cleanup();

    render([NEW_THREAD, SEARCH], { activeItemId: "__bb__/new-thread" });
    expect(screen.getByRole("button", { name: "New thread" }).getAttribute("aria-current")).toBe("page");
  });

  it("does not activate an entry bb reports as disabled", async () => {
    const slot = render([
      item("__bb__/new-thread", "New thread", { kind: "new-thread" }, { isDisabled: true }),
      { ...USAGE, isDisabled: true },
      { ...hidden(AUTOMATIONS), isDisabled: true },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    fireEvent.click((await openOverflow())[0]);
    expect(activated(slot)).toEqual([]);
  });

  it("never changes bb's order or visibility settings", async () => {
    const slot = render([NEW_THREAD, SEARCH, PLUGINS, hidden(USAGE)]);
    for (const name of ["Plugins", "New thread", "Search"]) fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.click((await openOverflow())[0]);
    const methods = slot.inspection.sidebarNavigationCalls.map((call) => call.method);
    expect(methods.filter((method) => method !== "activate")).toEqual([]);
    expect(slot.inspection.sdkCalls).toEqual([]);
  });
});
