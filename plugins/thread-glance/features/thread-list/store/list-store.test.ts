// @vitest-environment jsdom
// The list store: bb's data waits for an animation frame, and a burst of it
// is one update; bb's equal data with new identities, and whatever a person
// does, are applied as the store's rules say.
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThread, PROJECTS } from "../testing/fixtures";
import { NO_HOST, type HostData } from "./derive";
import { createListStore, listStatusOf } from "./list-store";

afterEach(() => {
  vi.unstubAllGlobals();
});

const host = (patch: Partial<HostData> = {}): HostData => ({
  ...NO_HOST,
  status: "ready",
  threads: [makeThread({ id: "a" })],
  projects: PROJECTS,
  ...patch,
});

/** A store fed its first data, with animation frames held until `frame()` runs them. */
function storeWithFrames() {
  const pending: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => pending.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const store = createListStore();
  store.feedHost(host());
  let updates = 0;
  store.subscribe(() => (updates += 1));
  return {
    store,
    updates: () => updates,
    frame: () => {
      for (const run of pending.splice(0)) run(0);
    },
  };
}

describe("the list store", () => {
  it("draws bb's first data at once, and applies later bursts once, on the next frame", () => {
    const { store, updates, frame } = storeWithFrames();
    expect(store.getState().model?.byId.has("a")).toBe(true);
    store.feedHost(host({ threads: [makeThread({ id: "a" }), makeThread({ id: "b" })] }));
    store.feedHost(host({ threads: [makeThread({ id: "a" }), makeThread({ id: "b" }), makeThread({ id: "c" })] }));
    expect(updates()).toBe(0);
    expect(store.getState().model?.byId.has("b")).toBe(false);
    frame();
    expect(updates()).toBe(1);
    expect([...store.getState().model!.byId.keys()]).toEqual(["a", "b", "c"]);
  });

  it("applies what flush finds waiting, as a test does", () => {
    const { store, frame } = storeWithFrames();
    store.feedHost(host({ threads: [makeThread({ id: "b" })] }));
    store.flush();
    expect([...store.getState().model!.byId.keys()]).toEqual(["b"]);
    frame();
    expect([...store.getState().model!.byId.keys()]).toEqual(["b"]);
  });

  it("takes bb's equal lists with new identities as no change", () => {
    const first = host({ sections: [{ id: "s", name: "Later", createdAt: 1, updatedAt: 1 }] });
    const { store, updates, frame } = storeWithFrames();
    store.feedHost(first);
    frame();
    const before = store.getState();
    store.feedHost({
      ...first,
      projects: first.projects.map((project) => ({ ...project })),
      sections: first.sections.map((section) => ({ ...section })),
      environmentProviders: [],
      draftIds: new Set(),
    });
    frame();
    expect(store.getState()).toBe(before);
    expect(updates()).toBe(1);
  });

  it("applies the focused thread, preferences and the list's own state at once", () => {
    const { store, updates } = storeWithFrames();
    store.feedFocus("a", false);
    expect(store.getState().inputs.activeThreadId).toBe("a");
    store.updateClient({ density: "comfortable" });
    expect(store.getState().layout.density).toBe("comfortable");
    store.setUi({ editingId: "a" });
    expect(store.getState().ui.editingId).toBe("a");
    expect(updates()).toBe(3);
    // Setting what it holds tells nobody.
    store.setUi({ editingId: "a" });
    store.feedFocus("a", false);
    expect(updates()).toBe(3);
  });

  it("draws the list once bb's threads, the preferences and the model are all in", () => {
    const store = createListStore();
    expect(listStatusOf(store.getState())).toBe("loading");
    store.feedHost(host());
    expect(listStatusOf(store.getState())).toBe("loading");
    store.feed({ hydrated: true });
    expect(listStatusOf(store.getState())).toBe("ready");
    const failed = createListStore();
    failed.feedHost(host({ status: "error" }));
    expect(listStatusOf(failed.getState())).toBe("error");
  });
});
