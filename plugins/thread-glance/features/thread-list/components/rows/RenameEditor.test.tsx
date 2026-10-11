// @vitest-environment jsdom
// The inline editor against what takes focus from it: bb focuses the composer
// of a thread a double-click's first click just opened, after the editor is up,
// and on a cold thread that can be seconds later. The editor keeps focus until
// the user leaves it.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenameEditor } from "./RenameEditor";
import { isHeldByDialog, leavesByKey } from "./rename-focus";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const onSave = vi.fn();
  const onDone = vi.fn();
  render(
    <>
      <RenameEditor initial="Old" label="Rename Old" onSave={onSave} onDone={onDone} />
      <textarea aria-label="Composer" />
      <button type="button">Elsewhere</button>
    </>,
  );
  return {
    onSave,
    onDone,
    input: screen.getByRole("textbox", { name: "Rename Old" }) as HTMLInputElement,
    composer: screen.getByRole("textbox", { name: "Composer" }) as HTMLTextAreaElement,
    elsewhere: screen.getByRole("button", { name: "Elsewhere" }),
  };
}

const type = (input: HTMLInputElement, text: string) => {
  fireEvent.keyDown(input, { key: text.at(-1)! });
  fireEvent.change(input, { target: { value: text } });
};

describe("keeping focus", () => {
  it("takes focus back at once and however long after it opened", () => {
    const { input, composer, onDone } = setup();
    expect(document.activeElement).toBe(input);
    composer.focus();
    expect(document.activeElement).toBe(input);
    act(() => void vi.advanceTimersByTime(2_000));
    composer.focus();
    expect(document.activeElement).toBe(input);
    act(() => void vi.advanceTimersByTime(60 * 60_000));
    composer.focus();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Old");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the composer is focused late, and nothing lands in the composer", () => {
    const { input, composer, onDone } = setup();
    act(() => void vi.advanceTimersByTime(1_000));
    type(input, "New");
    act(() => void vi.advanceTimersByTime(1_000));
    composer.focus();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("New");
    expect(composer.value).toBe("");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("takes focus back when it goes to nothing, such as a closing menu's trigger being gone", () => {
    const { input, onDone } = setup();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => void vi.advanceTimersByTime(2_000));
    input.blur();
    expect(document.activeElement).toBe(input);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("is not ended by typing, a lone modifier key or a press inside it", () => {
    const { input, composer, onSave, onDone } = setup();
    for (const key of ["Alt", "Control", "Meta", "Shift"]) fireEvent.keyDown(input, { key });
    fireEvent.pointerDown(input);
    type(input, "New");
    composer.focus();
    expect(document.activeElement).toBe(input);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("leaves a dialog that opened on its own holding focus, with the rename still open", () => {
    const { input, onSave, onDone } = setup();
    act(() => void vi.advanceTimersByTime(2_000));
    render(
      <div role="dialog" aria-label="Pick a date">
        <button type="button">Pick</button>
      </div>,
    );
    const pick = screen.getByRole("button", { name: "Pick" });
    pick.focus();
    expect(document.activeElement).toBe(pick);
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe("Old");
    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("leaving the editor", () => {
  it("saves a changed title on a press outside it", () => {
    const { input, elsewhere, onSave, onDone } = setup();
    act(() => void vi.advanceTimersByTime(2_000));
    type(input, "New");
    fireEvent.pointerDown(elsewhere);
    expect(onSave).toHaveBeenCalledWith("New");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends on a press outside even when something else holds focus", () => {
    const { elsewhere, onSave, onDone } = setup();
    render(
      <div role="dialog" aria-label="Pick a date">
        <button type="button">Pick</button>
      </div>,
    );
    screen.getByRole("button", { name: "Pick" }).focus();
    fireEvent.pointerDown(elsewhere);
    expect(onSave).toHaveBeenCalledWith("Old");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("saves on Tab, once focus has left", () => {
    const { input, elsewhere, onSave, onDone } = setup();
    type(input, "New");
    fireEvent.keyDown(input, { key: "Tab" });
    elsewhere.focus();
    expect(onSave).toHaveBeenCalledWith("New");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("saves on Enter and cancels on Escape", () => {
    const first = setup();
    type(first.input, "New");
    fireEvent.keyDown(first.input, { key: "Enter" });
    expect(first.onSave).toHaveBeenCalledWith("New");
    expect(first.onDone).toHaveBeenCalledTimes(1);
    cleanup();
    const second = setup();
    type(second.input, "New");
    fireEvent.keyDown(second.input, { key: "Escape" });
    expect(second.onSave).not.toHaveBeenCalled();
    expect(second.onDone).toHaveBeenCalledTimes(1);
  });
});

describe("switching away from the window", () => {
  it("keeps the rename open when the window loses focus and gets it back", () => {
    const { input, onSave, onDone } = setup();
    type(input, "New");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.keyDown(input, { key: "Alt" });
    fireEvent.keyDown(input, { key: "Tab", altKey: true });
    fireEvent.blur(input);
    expect(onDone).not.toHaveBeenCalled();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fireEvent.focus(window);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("New");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("takes focus back on return when bb moved it while the window was away", () => {
    const { input, composer, onDone } = setup();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.blur(input);
    composer.focus();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fireEvent.focus(window);
    expect(document.activeElement).toBe(input);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("what leaves the editor", () => {
  it("is Tab, but not Tab held with a key that switches windows", () => {
    const keys = { altKey: false, ctrlKey: false, metaKey: false };
    expect(leavesByKey({ key: "Tab", ...keys })).toBe(true);
    expect(leavesByKey({ key: "Tab", ...keys, altKey: true })).toBe(false);
    expect(leavesByKey({ key: "Tab", ...keys, metaKey: true })).toBe(false);
    expect(leavesByKey({ key: "Tab", ...keys, ctrlKey: true })).toBe(false);
    expect(leavesByKey({ key: "a", ...keys })).toBe(false);
    expect(leavesByKey({ key: "Alt", ...keys, altKey: true })).toBe(false);
  });

  it("holds a dialog's focus, and an alert dialog's, and nothing else", () => {
    document.body.innerHTML = '<div role="dialog"><i id="a"></i></div><div role="alertdialog"><i id="b"></i></div><i id="c"></i>';
    expect(isHeldByDialog(document.getElementById("a"))).toBe(true);
    expect(isHeldByDialog(document.getElementById("b"))).toBe(true);
    expect(isHeldByDialog(document.getElementById("c"))).toBe(false);
    expect(isHeldByDialog(null)).toBe(false);
    document.body.innerHTML = "";
  });
});
