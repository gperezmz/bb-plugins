// @vitest-environment jsdom
// The inline editor against what takes focus from it: bb focuses the composer
// of a thread a double-click's first click just opened, after the editor is up.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameEditor } from "./RenameEditor";

afterEach(cleanup);

function setup() {
  const onSave = vi.fn();
  const onDone = vi.fn();
  render(
    <>
      <RenameEditor initial="Old" label="Rename Old" onSave={onSave} onDone={onDone} />
      <textarea aria-label="Composer" />
    </>,
  );
  return { onSave, onDone, input: screen.getByRole("textbox", { name: "Rename Old" }), composer: screen.getByRole("textbox", { name: "Composer" }) };
}

describe("RenameEditor", () => {
  it("takes focus back when something other than the user moves it away at once", () => {
    const { input, composer, onDone } = setup();
    expect(document.activeElement).toBe(input);
    composer.focus();
    expect(document.activeElement).toBe(input);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("saves on blur once the user has typed", () => {
    const { input, composer, onSave, onDone } = setup();
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.change(input, { target: { value: "New" } });
    composer.focus();
    expect(onSave).toHaveBeenCalledWith("New");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("saves on blur once the user has clicked elsewhere", () => {
    const { composer, onSave, onDone } = setup();
    fireEvent.pointerDown(composer);
    composer.focus();
    expect(onSave).toHaveBeenCalledWith("Old");
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
