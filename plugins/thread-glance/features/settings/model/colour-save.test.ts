import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appearance, Versioned } from "@/shared/signals";
import { COLOUR_DELAY_MS, createColourSave } from "./colour-save";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ANSWER: Versioned<Appearance> = { epoch: "e", version: 2, value: { colours: {}, icons: {} } };

function host(write = vi.fn(async () => ANSWER)) {
  return { write, saved: vi.fn(), failed: vi.fn() };
}

describe("a picked colour", () => {
  it("is sent lowered once the picks stop, only the last of them", async () => {
    const h = host();
    const save = createColourSave(h);
    save.pick("proj_a", "#AABBC");
    save.pick("proj_a", "#AABBCC");
    await vi.advanceTimersByTimeAsync(COLOUR_DELAY_MS - 1);
    expect(h.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledWith("proj_a", "#aabbcc");
    expect(h.saved).toHaveBeenCalledWith(ANSWER, "#aabbcc");
  });

  it("is not sent when it is no colour, and cancels the one waiting", async () => {
    const h = host();
    const save = createColourSave(h);
    save.pick("proj_a", "#112233");
    save.pick("proj_a", "red");
    await vi.advanceTimersByTimeAsync(COLOUR_DELAY_MS * 2);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("goes at once on commit, and not again when the wait ends", async () => {
    const h = host();
    const save = createColourSave(h);
    save.pick("proj_a", "#112233");
    save.commit();
    await vi.advanceTimersByTimeAsync(COLOUR_DELAY_MS * 2);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("is dropped by cancel", async () => {
    const h = host();
    const save = createColourSave(h);
    save.pick("proj_a", "#112233");
    save.cancel();
    save.commit();
    await vi.advanceTimersByTimeAsync(COLOUR_DELAY_MS * 2);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("reports a refused save", async () => {
    const h = host(vi.fn(async () => Promise.reject(new Error("no"))));
    const save = createColourSave(h);
    save.pick("proj_a", "#112233");
    await vi.advanceTimersByTimeAsync(COLOUR_DELAY_MS);
    expect(h.failed).toHaveBeenCalledWith(new Error("no"));
    expect(h.saved).not.toHaveBeenCalled();
  });
});
