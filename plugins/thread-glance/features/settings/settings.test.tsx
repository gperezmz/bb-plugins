// @vitest-environment jsdom
// The settings page (AC26), its autosave, and the parts of AC22, AC24 and
// AC25 that live on it: the typed-name removal in Project management, the
// project colour and the icon upload.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { endPluginLifetime, pluginData } from "@/features/thread-list";
import { makeProject } from "@/testing/fixtures";
import { DEFAULT_SETTINGS, type Settings } from "@/shared/settings";
import type { Appearance } from "@/shared/signals";
import { SAVE_DELAY_MS, SAVED_SHOWN_MS } from "./model/autosave";
import { SAVE_FAILED_TOAST } from "./use-autosave";
import { SettingsPage } from "./components/SettingsPage";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toasts.success, error: toasts.error } }));

const PROJECTS = [makeProject("proj_personal", "Personal", { isPersonal: true }), makeProject("proj_a", "Alpha"), makeProject("proj_b", "Beta")];

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  endPluginLifetime();
  toasts.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The plugin server's settings and appearance as the page's calls change them. */
function fakeServer(held: Partial<Settings> = {}) {
  const epoch = "page";
  let version = 1;
  let settings: Settings = { ...DEFAULT_SETTINGS, ...held };
  let appearance: Appearance = { colours: {}, icons: {} };
  const calls: { method: string; input: unknown }[] = [];
  const failing = new Set<string>();
  const refusals = new Map<string, string>();
  const server = {
    calls,
    /** Makes writeSettings reject. */
    failWrites: (on: boolean) => void (on ? failing.add("writeSettings") : failing.delete("writeSettings")),
    refuse: (method: string, text: string) => void refusals.set(method, text),
    appearance: () => appearance,
    versioned: () => ({ epoch, version, value: settings }),
    /** Another window changed settings: the server holds them and the page hears the signal. */
    elsewhere(patch: Partial<Settings>) {
      settings = { ...settings, ...patch };
      version += 1;
      act(() => pluginData.settingsSignal({ epoch, version, value: settings }));
    },
    rpc: {
      writeSettings: async (input: { patch: Partial<Settings> }) => {
        calls.push({ method: "writeSettings", input });
        if (failing.has("writeSettings")) throw new Error("down");
        settings = { ...settings, ...input.patch };
        version += 1;
        return { epoch, version, value: settings };
      },
      setProjectColour: async (input: { projectId: string; colour: string }) => {
        calls.push({ method: "setProjectColour", input });
        appearance = { ...appearance, colours: { ...appearance.colours, [input.projectId]: input.colour } };
        return { epoch, version: ++version, value: appearance };
      },
      resetProjectColour: async (input: { projectId: string }) => {
        calls.push({ method: "resetProjectColour", input });
        const { [input.projectId]: _removed, ...colours } = appearance.colours;
        appearance = { ...appearance, colours };
        return { epoch, version: ++version, value: appearance };
      },
      uploadProjectIcon: async (input: { projectId: string; name: string }) => {
        calls.push({ method: "uploadProjectIcon", input });
        const refusal = refusals.get("uploadProjectIcon");
        if (refusal !== undefined) throw new Error(refusal);
        appearance = { ...appearance, icons: { ...appearance.icons, [input.projectId]: { name: input.name, mime: "image/png", updatedAt: 5 } } };
        return { epoch, version: ++version, value: appearance };
      },
      clearProjectIcon: async (input: { projectId: string }) => {
        calls.push({ method: "clearProjectIcon", input });
        const { [input.projectId]: _removed, ...icons } = appearance.icons;
        appearance = { ...appearance, icons };
        return { epoch, version: ++version, value: appearance };
      },
      forgetProject: async (input: { projectId: string }) => {
        calls.push({ method: "forgetProject", input });
        return { epoch, version: ++version, value: appearance };
      },
    },
  };
  return server;
}

/** The page open; with `arrived`, the server's settings have already reached this window. */
function openPage(server: ReturnType<typeof fakeServer>, options: { arrived?: boolean; sdk?: Record<string, unknown> } = {}) {
  if (options.arrived !== false) pluginData.settingsSignal(server.versioned());
  return renderSlot({ component: SettingsPage }, {}, {
    sidebarThreads: { status: "ready", threads: [], projects: PROJECTS },
    rpc: server.rpc as never,
    sdk: { projects: { delete: vi.fn(async () => ({ ok: true })) }, ...options.sdk } as never,
  });
}

const settle = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
const toggle = (name: string) => screen.getByRole("switch", { name });
const status = () => screen.getByRole("status").textContent;
const typeInto = (label: string, value: string) => act(() => void fireEvent.change(screen.getByLabelText(label), { target: { value } }));
const writes = (server: ReturnType<typeof fakeServer>) => server.calls.filter((call) => call.method === "writeSettings").map((call) => call.input);

describe("the page (AC26)", () => {
  it("is a bb settings section", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    expect(app.settingsSections.map((section) => section.id)).toEqual(["thread-glance"]);
  });

  it("holds the six groups, each reachable from the navigation strip", () => {
    openPage(fakeServer());
    const strip = screen.getByRole("navigation", { name: "Settings groups" });
    const names = ["Sidebar layout", "Project appearance", "Thread behavior", "Child threads", "This device", "Project management"];
    expect(within(strip).getAllByRole("button").map((button) => button.textContent)).toEqual(names);
    for (const name of names) expect(screen.getByRole("heading", { name })).toBeTruthy();
  });

  it("shows the defaults, ranges and choices of the five groups with settings", () => {
    openPage(fakeServer());
    expect(toggle("Compact working threads").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Working shelf").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Inactive shelf").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Dock shelves to the bottom").getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByText("Experimental")).toHaveLength(3);
    const hours = screen.getByLabelText("Hours before inactive") as HTMLInputElement;
    expect([hours.value, hours.min, hours.max]).toEqual(["6", "1", "720"]);

    expect(toggle("Project colors").getAttribute("aria-checked")).toBe("false");
    const stripes = screen.getByLabelText("Show stripes in") as HTMLSelectElement;
    expect(stripes.value).toBe("full-and-collapsed");
    expect([...stripes.options].map((option) => option.text)).toEqual(["Full and collapsed mode", "Full mode only", "Grouped projects only"]);

    expect(toggle("Settle quiet threads").getAttribute("aria-checked")).toBe("true");
    const days = screen.getByLabelText("Days before auto-settle") as HTMLInputElement;
    expect([days.value, days.min, days.max]).toEqual(["3", "1", "90"]);
    expect(toggle("Settle merged pull requests").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Closed pull requests always count/)).toBeTruthy();

    expect(toggle("Show children that need attention").getAttribute("aria-checked")).toBe("true");
    const order = screen.getByLabelText("Order") as HTMLSelectElement;
    expect([...order.options].map((option) => option.text)).toEqual(["Date created", "Last activity"]);
    expect(order.value).toBe("created");
    const direction = screen.getByLabelText("Direction") as HTMLSelectElement;
    expect([...direction.options].map((option) => option.text)).toEqual(["Oldest first", "Newest first"]);
    expect(direction.value).toBe("oldest");
    const icon = screen.getByLabelText("Icon") as HTMLSelectElement;
    expect([...icon.options].map((option) => option.text)).toEqual(["Colour circle", "Provider icon"]);
    expect(icon.value).toBe("colour-circle");
  });

  it("shows the defaults, so Inactive is on, until the server's settings arrive, then the server's", () => {
    const server = fakeServer({ inactiveShelf: false });
    openPage(server, { arrived: false });
    expect(toggle("Inactive shelf").getAttribute("aria-checked")).toBe("true");
    act(() => pluginData.settingsSignal(server.versioned()));
    expect(toggle("Inactive shelf").getAttribute("aria-checked")).toBe("false");
  });

  it("previews the snooze shortcuts as the presets they parse to, with their labels", () => {
    openPage(fakeServer());
    const preview = screen.getByRole("list", { name: "Snooze shortcut preview" });
    expect(within(preview).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "1 hour",
      "Wait refresh (5 hours)",
      "This evening",
      "Tomorrow morning",
      "Next week",
    ]);
    typeInto("Snooze shortcuts", "90m, Standup=tomorrow@10:30");
    expect(within(preview).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["90 minutes", "Standup"]);
  });

  it("refuses an invalid snooze shortcut inline and saves nothing", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    typeInto("Snooze shortcuts", "soon");
    expect(screen.getByRole("alert").textContent).toMatch(/"soon"/);
    await settle(SAVE_DELAY_MS * 4);
    expect(writes(server)).toEqual([]);
  });

  it("shows an error for Days before auto-settle set to 0 and saves nothing", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    typeInto("Days before auto-settle", "0");
    expect(screen.getByRole("alert").textContent).toBe("Use at least 1 day.");
    await settle(SAVE_DELAY_MS * 4);
    expect(writes(server)).toEqual([]);
    expect(status()).toBe("");
  });

  it("shows the range errors of both number fields and a message for a non-number", async () => {
    openPage(fakeServer());
    typeInto("Hours before inactive", "721");
    expect(screen.getByRole("alert").textContent).toBe("Use at most 720 hours.");
    typeInto("Hours before inactive", "1.5");
    expect(screen.getByRole("alert").textContent).toBe("Enter a whole number of hours.");
    typeInto("Hours before inactive", "");
    expect(screen.getByRole("alert").textContent).toBe("Enter a whole number of hours.");
    typeInto("Hours before inactive", "720");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("autosave", () => {
  it("saves 500 ms after the last edit, showing Saving… then Saved for 2 s", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    typeInto("Hours before inactive", "12");
    expect(status()).toBe("Saving…");
    await settle(SAVE_DELAY_MS - 1);
    expect(writes(server)).toEqual([]);
    await settle(1);
    expect(writes(server)).toEqual([{ patch: { hoursBeforeInactive: 12 } }]);
    expect(status()).toBe("Saved");
    expect((screen.getByLabelText("Hours before inactive") as HTMLInputElement).value).toBe("12");
    await settle(SAVED_SHOWN_MS - 1);
    expect(status()).toBe("Saved");
    await settle(1);
    expect(status()).toBe("");
  });

  it("restarts the wait on every edit, and sends one write holding only the edited fields", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    typeInto("Hours before inactive", "7");
    await settle(300);
    fireEvent.click(toggle("Working shelf"));
    await settle(300);
    expect(writes(server)).toEqual([]);
    typeInto("Hours before inactive", "9");
    await settle(SAVE_DELAY_MS);
    expect(writes(server)).toEqual([{ patch: { hoursBeforeInactive: 9, workingShelf: true } }]);
  });

  it("sends nothing for an edit put back to the server's value", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    fireEvent.click(toggle("Dock shelves to the bottom"));
    fireEvent.click(toggle("Dock shelves to the bottom"));
    await settle(SAVE_DELAY_MS);
    expect(writes(server)).toEqual([]);
    expect(status()).toBe("");
  });

  it("saves the valid fields while another is invalid, and keeps the invalid text", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    typeInto("Days before auto-settle", "0");
    fireEvent.click(toggle("Settle merged pull requests"));
    await settle(SAVE_DELAY_MS);
    expect(writes(server)).toEqual([{ patch: { settleMergedPullRequests: false } }]);
    expect((screen.getByLabelText("Days before auto-settle") as HTMLInputElement).value).toBe("0");
    expect(screen.getByRole("alert").textContent).toBe("Use at least 1 day.");
  });

  it("sends the choice fields as they are named", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    fireEvent.change(screen.getByLabelText("Show stripes in"), { target: { value: "grouped" } });
    fireEvent.change(screen.getByLabelText("Order"), { target: { value: "activity" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "newest" } });
    fireEvent.change(screen.getByLabelText("Icon"), { target: { value: "provider-icon" } });
    await settle(SAVE_DELAY_MS);
    expect(writes(server)).toEqual([{ patch: { stripesIn: "grouped", childOrder: "activity", childDirection: "newest", childIcon: "provider-icon" } }]);
  });

  it("sends a pending save at once when the page is left", async () => {
    fakeTimers();
    const server = fakeServer();
    const view = openPage(server);
    fireEvent.click(toggle("Compact working threads"));
    expect(writes(server)).toEqual([]);
    await act(async () => void view.unmount());
    expect(writes(server)).toEqual([{ patch: { compactWorkingThreads: true } }]);
    expect(pluginData.settings().compactWorkingThreads).toBe(true);
  });

  it("sends a pending save when the page is hidden", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    fireEvent.click(toggle("Compact working threads"));
    await act(async () => void window.dispatchEvent(new Event("pagehide")));
    expect(writes(server)).toEqual([{ patch: { compactWorkingThreads: true } }]);
  });

  it("runs one save at a time: an edit made during a save goes after it", async () => {
    fakeTimers();
    const server = fakeServer();
    let release: () => void = () => {};
    const write = server.rpc.writeSettings;
    server.rpc.writeSettings = async (input) => {
      const answer = await write(input);
      await new Promise<void>((resolve) => (release = resolve));
      return answer;
    };
    openPage(server);
    fireEvent.click(toggle("Working shelf"));
    await settle(SAVE_DELAY_MS);
    fireEvent.click(toggle("Dock shelves to the bottom"));
    await settle(SAVE_DELAY_MS);
    expect(writes(server)).toEqual([{ patch: { workingShelf: true } }]);
    await act(async () => release());
    await settle(0);
    expect(writes(server)).toEqual([{ patch: { workingShelf: true } }, { patch: { dockShelves: true } }]);
  });

  it("shows Not saved with a toast when the save fails, keeping what was typed", async () => {
    fakeTimers();
    const server = fakeServer();
    server.failWrites(true);
    openPage(server);
    fireEvent.click(toggle("Working shelf"));
    await settle(SAVE_DELAY_MS);
    expect(status()).toBe("Not saved");
    expect(toasts.error).toHaveBeenCalledWith(SAVE_FAILED_TOAST);
    expect(SAVE_FAILED_TOAST).toBe("Could not save sidebar settings");
    expect(toggle("Working shelf").getAttribute("aria-checked")).toBe("true");
    server.failWrites(false);
    fireEvent.click(toggle("Dock shelves to the bottom"));
    await settle(SAVE_DELAY_MS);
    expect(writes(server).at(-1)).toEqual({ patch: { workingShelf: true, dockShelves: true } });
    expect(status()).toBe("Saved");
  });
});

describe("a change in another window", () => {
  it("reloads the page's values", () => {
    const server = fakeServer();
    openPage(server);
    server.elsewhere({ dockShelves: true, daysBeforeAutoSettle: 10 });
    expect(toggle("Dock shelves to the bottom").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Days before auto-settle") as HTMLInputElement).value).toBe("10");
  });

  it("does not overwrite a field being edited, and saves the edit over it", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    typeInto("Hours before inactive", "12");
    server.elsewhere({ hoursBeforeInactive: 9, dockShelves: true });
    expect((screen.getByLabelText("Hours before inactive") as HTMLInputElement).value).toBe("12");
    expect(toggle("Dock shelves to the bottom").getAttribute("aria-checked")).toBe("true");
    await settle(SAVE_DELAY_MS);
    expect(writes(server)).toEqual([{ patch: { hoursBeforeInactive: 12 } }]);
    expect(pluginData.settings()).toMatchObject({ hoursBeforeInactive: 12, dockShelves: true });
  });
});

describe("Customize a project (AC24, AC25)", () => {
  const colourField = () => screen.getByLabelText("Project colour") as HTMLInputElement;

  it("previews the project and says where its icon comes from", async () => {
    const server = fakeServer();
    openPage(server);
    const preview = screen.getByRole("group", { name: "Preview" });
    expect(within(preview).getByText("Personal")).toBeTruthy();
    expect(screen.getByText("Found automatically from the project's favicon.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use automatic" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Customize a project"), { target: { value: "proj_a" } });
    expect(within(preview).getByText("Alpha")).toBeTruthy();
  });

  it("saves a picked #rrggbb after 500 ms for the chosen project, and Reset removes it", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    fireEvent.change(screen.getByLabelText("Customize a project"), { target: { value: "proj_a" } });
    act(() => void fireEvent.change(colourField(), { target: { value: "#A1B2C3" } }));
    await settle(SAVE_DELAY_MS - 1);
    expect(server.calls).toEqual([]);
    await settle(1);
    expect(server.calls).toEqual([{ method: "setProjectColour", input: { projectId: "proj_a", colour: "#a1b2c3" } }]);
    expect(colourField().value).toBe("#a1b2c3");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await settle(0);
    expect(server.calls.at(-1)).toEqual({ method: "resetProjectColour", input: { projectId: "proj_a" } });
    expect(server.appearance().colours).toEqual({});
  });

  it("refuses a colour that is not #rrggbb and saves nothing", async () => {
    fakeTimers();
    const server = fakeServer();
    openPage(server);
    act(() => void fireEvent.change(colourField(), { target: { value: "#12345" } }));
    expect(screen.getByRole("alert").textContent).toBe("Use a colour like #1a2b3c.");
    await settle(SAVE_DELAY_MS * 2);
    expect(server.calls).toEqual([]);
  });

  it("sends a picked colour still waiting when the page is left", async () => {
    fakeTimers();
    const server = fakeServer();
    const view = openPage(server);
    act(() => void fireEvent.change(colourField(), { target: { value: "#00ff00" } }));
    await act(async () => void view.unmount());
    expect(server.calls).toEqual([{ method: "setProjectColour", input: { projectId: "proj_personal", colour: "#00ff00" } }]);
  });

  it("uploads an icon, names it in the source line, and Use automatic takes it away", async () => {
    const server = fakeServer();
    openPage(server);
    fireEvent.change(screen.getByLabelText("Upload icon"), { target: { files: [new File(["abc"], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByText("Uploaded: logo.png")).toBeTruthy());
    expect(server.calls).toEqual([{ method: "uploadProjectIcon", input: { projectId: "proj_personal", name: "logo.png", mime: "image/png", dataBase64: "YWJj" } }]);
    fireEvent.click(screen.getByRole("button", { name: "Use automatic" }));
    await waitFor(() => expect(screen.getByText("Found automatically from the project's favicon.")).toBeTruthy());
    expect(server.calls.at(-1)).toEqual({ method: "clearProjectIcon", input: { projectId: "proj_personal" } });
  });

  it("shows the server's refusal of an upload, in its words", async () => {
    const server = fakeServer();
    server.refuse("uploadProjectIcon", "Use an SVG, PNG, ICO, JPEG, GIF, AVIF or WebP image.");
    openPage(server);
    fireEvent.change(screen.getByLabelText("Upload icon"), { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Use an SVG, PNG, ICO, JPEG, GIF, AVIF or WebP image."));
    expect(screen.getByText("Found automatically from the project's favicon.")).toBeTruthy();
  });

  it("refuses an image over 1 MB without sending it", async () => {
    const server = fakeServer();
    openPage(server);
    const big = new File([new Uint8Array(1_048_577)], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload icon"), { target: { files: [big] } });
    expect(screen.getByRole("alert").textContent).toBe("The image is larger than 1 MB.");
    expect(server.calls).toEqual([]);
  });
});

describe("Project management (AC22)", () => {
  it("lists the projects but the personal one, and warns", () => {
    openPage(fakeServer());
    const select = screen.getByLabelText("Remove a project") as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(["Alpha", "Beta"]);
    expect(screen.getByText("Its threads are removed from BB too. This cannot be undone.")).toBeTruthy();
  });

  it("removes the project only once its exact name is typed, then has the server forget its colour and icon", async () => {
    const server = fakeServer();
    const deleted = vi.fn(async () => ({ ok: true }));
    openPage(server, { sdk: { projects: { delete: deleted } } });
    const remove = screen.getByRole("button", { name: "Remove project" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    const name = within(screen.getByRole("region", { name: "Project management" })).getByLabelText("Project name");
    fireEvent.change(name, { target: { value: "alpha" } });
    expect(remove.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "Alpha" } });
    expect(remove.disabled).toBe(false);
    await act(async () => void fireEvent.click(remove));
    expect(deleted).toHaveBeenCalledWith({ projectId: "proj_a" });
    expect(server.calls).toEqual([{ method: "forgetProject", input: { projectId: "proj_a" } }]);
  });

  it("starts the typed name over for another project", () => {
    openPage(fakeServer());
    const region = screen.getByRole("region", { name: "Project management" });
    fireEvent.change(within(region).getByLabelText("Project name"), { target: { value: "Alpha" } });
    fireEvent.change(screen.getByLabelText("Remove a project"), { target: { value: "proj_b" } });
    expect((within(region).getByLabelText("Project name") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Remove project" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
