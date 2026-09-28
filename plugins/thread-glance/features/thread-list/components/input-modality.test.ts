import { describe, expect, it } from "vitest";
import { modalityOf } from "./input-modality";

describe("which input moved focus last", () => {
  it("is the pointer after a press and the keyboard after a key that can move focus", () => {
    expect(modalityOf({ type: "pointerdown" })).toBe("pointer");
    for (const key of ["Tab", "ArrowDown", "Escape", "Enter", " "]) expect(modalityOf({ type: "keydown", key })).toBe("keyboard");
  });
  it("is left as it was by a shortcut, a lone modifier or any other event", () => {
    expect(modalityOf({ type: "keydown", key: "k", metaKey: true })).toBeNull();
    expect(modalityOf({ type: "keydown", key: "c", ctrlKey: true })).toBeNull();
    expect(modalityOf({ type: "keydown", key: "Shift" })).toBeNull();
    expect(modalityOf({ type: "focus" })).toBeNull();
  });
});
