import { describe, expect, it } from "vitest";
import type { Endpoint } from "../src/endpoints.js";
import { createEndpointManager, type EndpointStore, type KeyFile } from "../src/manage.js";
import { readLegacy, type Legacy } from "../src/legacy.js";

/** An in-memory store and key file, which record what was changed and can be made to fail. */
function fakes(initial: Endpoint[] = [], keys: Record<string, string> = {}) {
  const state = { endpoints: initial, keys: { ...keys }, urls: {} as Record<string, string>, failWrite: false, failKeyFile: false, changes: [] as Endpoint[][], log: [] as string[] };
  const store: EndpointStore = {
    read: async () => structuredClone(state.endpoints),
    write: async (list) => {
      if (state.failWrite) throw new Error("storage is down");
      state.endpoints = structuredClone([...list]);
    },
  };
  const keyFile: KeyFile = {
    put: async (id, key, url) => {
      state.log.push(`put ${id}`);
      if (state.failKeyFile) throw new Error("no primary machine");
      state.keys[id] = key;
      state.urls[id] = url;
    },
    remove: async (id) => {
      state.log.push(`remove ${id}`);
      if (state.failKeyFile) throw new Error("no primary machine");
      delete state.keys[id];
    },
  };
  const manager = createEndpointManager({ store, keyFile, changed: (list) => void state.changes.push(structuredClone([...list])) });
  return { state, manager };
}

const mlx: Endpoint = { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "q", key: { kind: "literal", set: true } };
const mac: Endpoint = { id: "mac", url: "http://192.168.1.5:8083/v1", model: "m", key: { kind: "variable", reference: "${MAC_INFERENCE_KEY}" } };
const draft = (over = {}) => ({ id: "new", url: "http://127.0.0.1:9000/v1", model: "m", key: { kind: "none" } as const, ...over });

describe("save", () => {
  it("stores a new Endpoint, keeps its literal key in the key file only, and reports the list", async () => {
    const { state, manager } = fakes();
    const result = await manager.save(draft({ id: "mlx", key: { kind: "literal", value: "sk-test" } }), true);
    expect(result).toMatchObject({ ok: true, endpoints: [{ id: "mlx", key: { kind: "literal", set: true } }] });
    expect(state.keys).toEqual({ mlx: "sk-test" });
    expect(JSON.stringify(state.endpoints)).not.toContain("sk-test");
    expect(state.changes).toHaveLength(1);
  });

  it("keeps a key with the URL it was typed for", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-old" });
    await manager.save({ id: "mlx", url: "http://127.0.0.1:9/v1", model: "q", key: { kind: "literal", value: "sk-new" } }, false);
    expect(state.urls).toEqual({ mlx: "http://127.0.0.1:9/v1" });
  });

  it("changes nothing when a field is refused", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-test" });
    expect(await manager.save(draft({ id: "mlx", model: "" }), true)).toMatchObject({ ok: false, fields: { id: expect.any(String), model: expect.any(String) } });
    expect(state.endpoints).toEqual([mlx]);
    expect(state.keys).toEqual({ mlx: "sk-test" });
    expect(state.log).toEqual([]);
    expect(state.changes).toEqual([]);
  });

  it("deletes a literal key when saved with Key None or Variable", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-test" });
    await manager.save({ id: "mlx", url: mlx.url, model: "q", key: { kind: "variable", reference: "${K}" } }, false);
    expect(state.keys).toEqual({});
    expect(state.endpoints[0]!.key).toEqual({ kind: "variable", reference: "${K}" });
  });

  it("clears the literal key when the URL changes", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-test" });
    await manager.save({ id: "mlx", url: "http://127.0.0.1:1/v1", model: "q", key: { kind: "literal", value: null } }, false);
    expect(state.keys).toEqual({});
    expect(state.endpoints[0]).toMatchObject({ url: "http://127.0.0.1:1/v1", key: { kind: "literal", set: false } });
  });

  it("replaces the key in the key file, leaving the old one nowhere", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-old" });
    await manager.save({ id: "mlx", url: mlx.url, model: "q", key: { kind: "literal", value: "sk-new" } }, false);
    expect(state.keys).toEqual({ mlx: "sk-new" });
  });

  it("changes no Endpoint when the key file fails", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-old" });
    state.failKeyFile = true;
    await expect(manager.save({ id: "mlx", url: mlx.url, model: "other", key: { kind: "literal", value: "sk-new" } }, false)).rejects.toThrow("no primary machine");
    expect(state.endpoints).toEqual([mlx]);
    expect(state.keys).toEqual({ mlx: "sk-old" });
    expect(state.changes).toEqual([]);
  });

  it("takes back the key it put for a new Endpoint that could not be stored", async () => {
    const { state, manager } = fakes();
    state.failWrite = true;
    await expect(manager.save(draft({ id: "mlx", key: { kind: "literal", value: "sk-test" } }), true)).rejects.toThrow("storage is down");
    expect(state.keys).toEqual({});
  });

  it("says the key must be typed again when it was replaced for a new URL and the Endpoint could not be stored", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-old" });
    state.failWrite = true;
    await expect(manager.save({ id: "mlx", url: "http://127.0.0.1:9/v1", model: "q", key: { kind: "literal", value: "sk-new" } }, false)).rejects.toThrow(
      "storage is down The key was changed and must be typed again.",
    );
  });

  it("keeps the replaced key, which is in effect, when the Endpoint's URL is the same and it could not be stored", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-old" });
    state.failWrite = true;
    await expect(manager.save({ id: "mlx", url: mlx.url, model: "q", key: { kind: "literal", value: "sk-new" } }, false)).rejects.toThrow("storage is down");
    expect(state.keys).toEqual({ mlx: "sk-new" });
  });

  it("takes back a key put for an Endpoint that held none, so it is left in no file", async () => {
    const { state, manager } = fakes([mac]);
    state.failWrite = true;
    await expect(manager.save({ id: "mac", url: mac.url, model: "m", key: { kind: "literal", value: "sk-new" } }, false)).rejects.toThrow("storage is down");
    expect(state.keys).toEqual({});
  });

  it("runs saves one at a time, so none overwrites another", async () => {
    const { state, manager } = fakes();
    await Promise.all(["a1", "b1", "c1"].map((id) => manager.save(draft({ id }), true)));
    expect(state.endpoints.map((e) => e.id)).toEqual(["a1", "b1", "c1"]);
  });
});

describe("set, the command's save", () => {
  it("adds an Endpoint with no key, or with a reference", async () => {
    const { state, manager } = fakes();
    await manager.set({ id: "a1", url: "http://a.example.com/v1", model: "m", key: null });
    await manager.set({ id: "b1", url: "http://b.example.com/v1", model: "m", key: "${B_KEY}" });
    expect(state.endpoints.map((e) => e.key)).toEqual([{ kind: "none" }, { kind: "variable", reference: "${B_KEY}" }]);
  });

  it("refuses what a card's Save refuses, a literal key among it", async () => {
    const { state, manager } = fakes();
    expect(await manager.set({ id: "A", url: "x", model: "", key: "sk-plain" })).toMatchObject({ ok: false, fields: { id: expect.any(String), url: expect.any(String), model: expect.any(String), key: expect.any(String) } });
    expect(state.endpoints).toEqual([]);
    expect(state.log).toEqual([]);
  });

  it("replaces the URL and model of a saved Endpoint and leaves its key", async () => {
    const { state, manager } = fakes([mac, mlx], { mlx: "sk-test" });
    await manager.set({ id: "mac", url: "http://192.168.1.6:8083/v1", model: "m2", key: null });
    await manager.set({ id: "mlx", url: mlx.url, model: "q2", key: null });
    expect(state.endpoints).toEqual([{ ...mac, url: "http://192.168.1.6:8083/v1", model: "m2" }, { ...mlx, model: "q2" }]);
    expect(state.keys).toEqual({ mlx: "sk-test" });
  });

  it("changes the key only when a reference is given, deleting a literal key it replaces", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-test" });
    await manager.set({ id: "mlx", url: mlx.url, model: "q", key: "${MLX_KEY}" });
    expect(state.endpoints[0]!.key).toEqual({ kind: "variable", reference: "${MLX_KEY}" });
    expect(state.keys).toEqual({});
  });

  it("refuses a new URL for an Endpoint with a literal key even when a reference is given", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-test" });
    expect(await manager.set({ id: "mlx", url: "http://127.0.0.1:1/v1", model: "q", key: "${MLX_KEY}" })).toEqual({ ok: false, problem: expect.stringContaining("page") });
    expect(state.endpoints).toEqual([mlx]);
    expect(state.keys).toEqual({ mlx: "sk-test" });
  });

  it("refuses a new URL for an Endpoint with a literal key, and names the page", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-test" });
    const result = await manager.set({ id: "mlx", url: "http://127.0.0.1:1/v1", model: "q", key: null });
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("page") });
    expect(state.endpoints).toEqual([mlx]);
    expect(state.keys).toEqual({ mlx: "sk-test" });
  });
});

describe("remove", () => {
  it("deletes the Endpoint and its literal key", async () => {
    const { state, manager } = fakes([mac, mlx], { mlx: "sk-test" });
    expect(await manager.remove("mlx")).toMatchObject({ ok: true, endpoints: [{ id: "mac" }] });
    expect(state.keys).toEqual({});
    expect(state.changes).toHaveLength(1);
  });

  it("does not touch the key file for an Endpoint without a literal key", async () => {
    const { state, manager } = fakes([mac]);
    await manager.remove("mac");
    expect(state.log).toEqual([]);
  });

  it("keeps the Endpoint when its key cannot be deleted", async () => {
    const { state, manager } = fakes([mlx], { mlx: "sk-test" });
    state.failKeyFile = true;
    await expect(manager.remove("mlx")).rejects.toThrow();
    expect(state.endpoints).toEqual([mlx]);
  });

  it("says so for an Endpoint that is not there", async () => {
    const { manager } = fakes();
    expect(await manager.remove("gone")).toEqual({ ok: false, problem: expect.stringContaining('"gone"') });
  });
});

describe("copy, the copy of what 0.3 saved", () => {
  const items = (): Legacy[] => {
    const read = readLegacy('[{"id": "mac", "url": "http://192.168.1.5:8083/v1", "key": "${K}", "model": "m"}, {"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "q"}]', '{"mlx": "sk-mlx"}');
    if (!read.ok) throw new Error(read.reason);
    return read.items;
  };

  it("adds the Endpoints and puts the literal keys, and reports what it added", async () => {
    const { state, manager } = fakes();
    expect(await manager.copy(items())).toEqual(["mac", "mlx"]);
    expect(state.endpoints.map((e) => e.id)).toEqual(["mac", "mlx"]);
    expect(state.keys).toEqual({ mlx: "sk-mlx" });
    expect(state.urls).toEqual({ mlx: "http://127.0.0.1:8080/v1" });
    expect(JSON.stringify(state.endpoints)).not.toContain("sk-mlx");
  });

  it("skips an id the plugin already has, so a copy run twice adds nothing", async () => {
    const { state, manager } = fakes([{ ...mac, model: "mine" }]);
    expect(await manager.copy(items())).toEqual(["mlx"]);
    expect(state.endpoints[0]!.model).toBe("mine");
    expect(await manager.copy(items())).toEqual([]);
  });

  it("stores no Endpoint when a key cannot be kept, so the next attempt copies everything", async () => {
    const { state, manager } = fakes();
    state.failKeyFile = true;
    await expect(manager.copy(items())).rejects.toThrow();
    expect(state.endpoints).toEqual([]);
    state.failKeyFile = false;
    expect(await manager.copy(items())).toEqual(["mac", "mlx"]);
    expect(state.keys).toEqual({ mlx: "sk-mlx" });
  });
});
