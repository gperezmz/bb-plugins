// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Endpoint } from "@/src/endpoints";
import { createEndpointManager } from "@/src/manage";
import { SECTION_DESCRIPTION } from "./model";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;
beforeAll(async () => {
  app = await loadPluginApp(() => import("@/app"));
});
afterEach(cleanup);

const mac: Endpoint = { id: "mac", url: "http://192.168.1.5:8083/v1", model: "qwen3-4b", key: { kind: "variable", reference: "${MAC_INFERENCE_KEY}" } };
const mlx: Endpoint = { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "qwen3-4b", key: { kind: "literal", set: true } };

/** The server's side of the page: the real manager over an in-memory store and key vault. */
function server(initial: Endpoint[] = [], keys: Record<string, string> = {}, notice: string | null = null) {
  const state = { endpoints: initial, keys: { ...keys }, failSave: null as Error | null, saves: 0 };
  const manager = createEndpointManager({
    store: {
      read: async () => structuredClone(state.endpoints),
      write: async (list) => void (state.endpoints = structuredClone([...list])),
    },
    vault: {
      put: async (id, key) => void (state.keys[id] = key),
      remove: async (id) => void delete state.keys[id],
    },
    changed: () => undefined,
  });
  const rpc = {
    endpoints: async () => ({ endpoints: state.endpoints, notice }),
    saveEndpoint: async (input: unknown) => {
      const { draft, create } = input as { draft: Parameters<typeof manager.save>[0]; create: boolean };
      state.saves += 1;
      if (state.failSave !== null) throw state.failSave;
      return manager.save(draft, create);
    },
    removeEndpoint: (input: unknown) => manager.remove((input as { id: string }).id),
  };
  return { state, rpc };
}

const show = async (initial: Endpoint[] = [], keys: Record<string, string> = {}, notice: string | null = null) => {
  const fake = server(initial, keys, notice);
  const view = renderSlot(app.settingsSections[0]!, {}, { rpc: fake.rpc });
  await screen.findByRole("button", { name: "Add Endpoint" });
  return { ...fake, view };
};
const card = (name: string) => screen.getByRole("listitem", { name });
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const saved = async (fake: ReturnType<typeof server>, want: (list: Endpoint[]) => boolean) => waitFor(() => expect(want(fake.state.endpoints)).toBe(true));

describe("the section", () => {
  it("is registered with its heading and the line under it", () => {
    const [section] = app.settingsSections;
    expect(section).toMatchObject({ title: "Endpoints", description: SECTION_DESCRIPTION });
    expect(SECTION_DESCRIPTION).toBe(
      "Each Endpoint is an AI service: select it for thread titles or commit messages under Settings → AI services. After changing a variable an Endpoint references, reload the plugin.",
    );
  });

  it("shows a card for each Endpoint with its ID, URL, Model and Key, and no JSON box", async () => {
    await show([mac, mlx]);
    const first = within(card("mac"));
    expect((first.getByLabelText("ID") as HTMLInputElement).value).toBe("mac");
    expect((first.getByLabelText("URL") as HTMLInputElement).value).toBe(mac.url);
    expect((first.getByLabelText("Model") as HTMLInputElement).value).toBe("qwen3-4b");
    expect((first.getByRole("radio", { name: "Variable" }) as HTMLInputElement).checked).toBe(true);
    expect((first.getByLabelText("Key variable") as HTMLInputElement).value).toBe("${MAC_INFERENCE_KEY}");
    const second = within(card("mlx"));
    expect((second.getByRole("radio", { name: "Literal" }) as HTMLInputElement).checked).toBe(true);
    expect(second.getByText("Key set")).toBeTruthy();
    // One text box per field of each card, and none for a list of Endpoints.
    expect(screen.queryByRole("textbox", { name: /endpoints|keys/i })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("says no Endpoint is set, and offers Add Endpoint", async () => {
    await show();
    expect(screen.getByText("No Endpoint is set.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Endpoint" })).toBeTruthy();
  });

  it("says what could not be read of the old settings", async () => {
    await show([], {}, "The endpoints setting is not valid JSON. Nothing was copied.");
    expect(screen.getByRole("status").textContent).toContain("not valid JSON");
  });

  it("says why it cannot load", async () => {
    renderSlot(app.settingsSections[0]!, {}, { rpc: { endpoints: async () => Promise.reject(new Error("the server is down")) } });
    expect((await screen.findByRole("alert")).textContent).toContain("the server is down");
  });

  it("shows an Endpoint with no model empty, and asks for it", async () => {
    await show([{ ...mac, id: "old", model: null }]);
    const old = within(card("old"));
    expect((old.getByLabelText("Model") as HTMLInputElement).value).toBe("");
    expect(old.getByText("Enter the model this server answers with.")).toBeTruthy();
  });

  it("holds no saved literal key in anything it draws", async () => {
    const { view } = await show([mlx], { mlx: "sk-secret-key" });
    expect(view.container.innerHTML).not.toContain("sk-secret-key");
    for (const input of screen.getAllByRole("textbox") as HTMLInputElement[]) expect(input.value).not.toContain("sk-secret");
  });
});

describe("adding an Endpoint", () => {
  it("opens an empty card with an editable ID, Save and Cancel, no Remove, and Add Endpoint disabled", async () => {
    await show([mac]);
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));
    const fresh = within(card("New Endpoint"));
    const id = fresh.getByLabelText("ID") as HTMLInputElement;
    expect(id.readOnly).toBe(false);
    expect(id.value).toBe("");
    expect(fresh.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(fresh.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(fresh.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Add Endpoint" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("discards the card on Cancel without asking, and enables Add Endpoint", async () => {
    const fake = await show();
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));
    type(screen.getByLabelText("ID"), "half");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("button", { name: "Add Endpoint" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fake.state.saves).toBe(0);
  });

  it("saves a filled card with a literal key: the card becomes a saved one with its ID fixed and the key set", async () => {
    const fake = await show();
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));
    type(screen.getByLabelText("ID"), "mlx");
    type(screen.getByLabelText("URL"), "http://127.0.0.1:8080/v1");
    type(screen.getByLabelText("Model"), "qwen3-4b");
    fireEvent.click(screen.getByRole("radio", { name: "Literal" }));
    const key = screen.getByLabelText("Literal key") as HTMLInputElement;
    expect(key.type).toBe("password");
    type(key, "sk-test");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Key set");
    expect(fake.state.endpoints).toEqual([mlx]);
    expect(fake.state.keys).toEqual({ mlx: "sk-test" });
    expect((within(card("mlx")).getByLabelText("ID") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect((screen.getByRole("button", { name: "Add Endpoint" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("refuses an invalid card, naming each field, keeps what was typed, and changes nothing", async () => {
    const fake = await show([mac]);
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));
    const fresh = within(card("New Endpoint"));
    type(fresh.getByLabelText("ID"), "mac");
    type(fresh.getByLabelText("URL"), "nope");
    fireEvent.click(fresh.getByRole("button", { name: "Save" }));
    expect((await fresh.findByText(/already exists/)).textContent).toContain("mac");
    expect(fresh.getByText(/A URL is an http/)).toBeTruthy();
    expect(fresh.getByText(/A model is a model name/)).toBeTruthy();
    expect(fresh.getByLabelText("ID").getAttribute("aria-invalid")).toBe("true");
    expect((fresh.getByLabelText("URL") as HTMLInputElement).value).toBe("nope");
    expect(fake.state.endpoints).toEqual([mac]);
    // Typing in a field takes its message away.
    type(fresh.getByLabelText("ID"), "mac2");
    expect(fresh.queryByText(/already exists/)).toBeNull();
  });

  it("refuses a Variable key that is not a reference, and a Literal key with nothing typed", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));
    type(screen.getByLabelText("ID"), "gw");
    type(screen.getByLabelText("URL"), "http://gw.example.com/v1");
    type(screen.getByLabelText("Model"), "m");
    fireEvent.click(screen.getByRole("radio", { name: "Variable" }));
    type(screen.getByLabelText("Key variable"), "sk-plain");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/reference to bb's environment/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Literal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Type the key/)).toBeTruthy();
  });
});

describe("editing an Endpoint", () => {
  it("shows Save and Cancel once something changes, and applies nothing until Save", async () => {
    const fake = await show([mac]);
    const mine = within(card("mac"));
    expect(mine.queryByRole("button", { name: "Save" })).toBeNull();
    expect(mine.queryByRole("button", { name: "Cancel" })).toBeNull();
    type(mine.getByLabelText("Model"), "qwen3-8b");
    expect(mine.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(fake.state.endpoints[0]!.model).toBe("qwen3-4b");
    expect(fake.state.saves).toBe(0);
  });

  it("puts the card back as saved on Cancel", async () => {
    await show([mac]);
    const mine = within(card("mac"));
    type(mine.getByLabelText("Model"), "qwen3-8b");
    type(mine.getByLabelText("URL"), "http://x.example.com/v1");
    fireEvent.click(mine.getByRole("button", { name: "Cancel" }));
    expect((mine.getByLabelText("Model") as HTMLInputElement).value).toBe("qwen3-4b");
    expect((mine.getByLabelText("URL") as HTMLInputElement).value).toBe(mac.url);
    expect(mine.queryByRole("button", { name: "Save" })).toBeNull();
    expect(mine.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("saves a changed model, URL or key on Save", async () => {
    const fake = await show([mac]);
    const mine = within(card("mac"));
    type(mine.getByLabelText("Model"), "qwen3-8b");
    fireEvent.click(mine.getByRole("button", { name: "Save" }));
    await saved(fake, (list) => list[0]!.model === "qwen3-8b");
    await waitFor(() => expect(within(card("mac")).queryByRole("button", { name: "Save" })).toBeNull());
    type(within(card("mac")).getByLabelText("Key variable"), "${OTHER_KEY}");
    fireEvent.click(within(card("mac")).getByRole("button", { name: "Save" }));
    await saved(fake, (list) => list[0]!.key.kind === "variable" && list[0]!.key.reference === "${OTHER_KEY}");
  });

  it("does not let the ID of a saved Endpoint be changed", async () => {
    await show([mac]);
    const id = within(card("mac")).getByLabelText("ID") as HTMLInputElement;
    expect(id.readOnly).toBe(true);
    type(id, "other");
    // A read-only field takes no typing in a browser; the card is not edited by it either way.
    expect(id.readOnly).toBe(true);
  });

  it("keeps the edits and shows the error when Save fails for a reason other than a field", async () => {
    const fake = await show([mac]);
    fake.state.failSave = new Error("No primary machine is connected");
    const mine = within(card("mac"));
    type(mine.getByLabelText("Model"), "qwen3-8b");
    fireEvent.click(mine.getByRole("button", { name: "Save" }));
    expect((await mine.findByRole("alert")).textContent).toContain("No primary machine is connected");
    expect((mine.getByLabelText("Model") as HTMLInputElement).value).toBe("qwen3-8b");
    expect(mine.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(fake.state.endpoints[0]!.model).toBe("qwen3-4b");
    // The same Save can be tried again.
    fake.state.failSave = null;
    fireEvent.click(mine.getByRole("button", { name: "Save" }));
    await saved(fake, (list) => list[0]!.model === "qwen3-8b");
  });

  it("drops unsaved edits when the page is left, without asking", async () => {
    const fake = server([mac]);
    const first = renderSlot(app.settingsSections[0]!, {}, { rpc: fake.rpc });
    await screen.findByRole("button", { name: "Add Endpoint" });
    type(within(card("mac")).getByLabelText("Model"), "qwen3-8b");
    first.lifecycle.unmount();
    expect(screen.queryByRole("dialog")).toBeNull();
    renderSlot(app.settingsSections[0]!, {}, { rpc: fake.rpc });
    await screen.findByRole("button", { name: "Add Endpoint" });
    expect((within(card("mac")).getByLabelText("Model") as HTMLInputElement).value).toBe("qwen3-4b");
  });
});

describe("a literal key", () => {
  it("is shown as set with Replace, which empties a masked field, and Cancel keeps the saved key", async () => {
    const fake = await show([mlx], { mlx: "sk-old" });
    const mine = within(card("mlx"));
    expect(mine.queryByLabelText("Literal key")).toBeNull();
    fireEvent.click(mine.getByRole("button", { name: /Replace/ }));
    const key = mine.getByLabelText("Literal key") as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.value).toBe("");
    fireEvent.click(mine.getByRole("button", { name: "Cancel" }));
    expect(mine.getByText("Key set")).toBeTruthy();
    expect(mine.queryByLabelText("Literal key")).toBeNull();
    expect(fake.state.keys).toEqual({ mlx: "sk-old" });
  });

  it("is replaced by the key typed on Save, and the old one is gone", async () => {
    const fake = await show([mlx], { mlx: "sk-old" });
    const mine = within(card("mlx"));
    fireEvent.click(mine.getByRole("button", { name: /Replace/ }));
    type(mine.getByLabelText("Literal key"), "sk-new");
    fireEvent.click(mine.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.state.keys).toEqual({ mlx: "sk-new" }));
    expect(await screen.findByText("Key set")).toBeTruthy();
  });

  it("is kept when Replace is pressed and Save is pressed with nothing typed", async () => {
    const fake = await show([mlx], { mlx: "sk-old" });
    const mine = within(card("mlx"));
    fireEvent.click(mine.getByRole("button", { name: /Replace/ }));
    fireEvent.click(mine.getByRole("button", { name: "Save" }));
    await screen.findByText("Key set");
    expect(fake.state.keys).toEqual({ mlx: "sk-old" });
  });

  it("is cleared when the URL changes: the card then shows Literal, not set, and asks for the key", async () => {
    const fake = await show([mlx], { mlx: "sk-old" });
    const mine = within(card("mlx"));
    type(mine.getByLabelText("URL"), "http://127.0.0.1:9999/v1");
    expect(mine.getByRole("status").textContent).toContain("clears the saved key");
    fireEvent.click(mine.getByRole("button", { name: "Save" }));
    const again = await screen.findByLabelText("Literal key");
    expect(again).toBeTruthy();
    expect(within(card("mlx")).getByText("Key not set: type it to use this Endpoint.")).toBeTruthy();
    expect((within(card("mlx")).getByRole("radio", { name: "Literal" }) as HTMLInputElement).checked).toBe(true);
    expect(fake.state.keys).toEqual({});
    expect(fake.state.endpoints[0]).toMatchObject({ url: "http://127.0.0.1:9999/v1", key: { kind: "literal", set: false } });
  });

  it("is deleted when the Endpoint is saved with Key None or Variable", async () => {
    const fake = await show([mlx], { mlx: "sk-old" });
    const mine = within(card("mlx"));
    fireEvent.click(mine.getByRole("radio", { name: "None" }));
    fireEvent.click(mine.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.state.keys).toEqual({}));
    expect(fake.state.endpoints[0]!.key).toEqual({ kind: "none" });
  });
});

describe("removing an Endpoint", () => {
  it("asks first, with Remove and Keep, and Keep keeps it", async () => {
    const fake = await show([mac]);
    fireEvent.click(within(card("mac")).getByRole("button", { name: "Remove mac" }));
    expect(screen.getByText("Remove mac? If it's selected for an AI task, select another under Settings → AI services first, or that task stops.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText(/^Remove mac\?/)).toBeNull();
    expect(fake.state.endpoints).toEqual([mac]);
  });

  it("removes only on Remove, and the card goes", async () => {
    const fake = await show([mac, mlx], { mlx: "sk-old" });
    fireEvent.click(within(card("mlx")).getByRole("button", { name: "Remove mlx" }));
    expect(fake.state.endpoints).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing mlx" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "mlx" })).toBeNull());
    expect(fake.state.endpoints).toEqual([mac]);
    expect(fake.state.keys).toEqual({});
  });
});
