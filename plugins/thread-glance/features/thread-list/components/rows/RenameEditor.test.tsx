// @vitest-environment jsdom
// The inline editor against what takes focus from it: bb focuses the composer
// of a thread a double-click's first click just opened, after the editor is up,
// and on a cold thread that can be seconds later. The editor keeps focus until
// the user leaves it.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenameEditor } from "./RenameEditor";
import { isHeldByDialog, isInFrame, leavesByKey, openDialogs } from "./rename-focus";

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

  it("is not switched off by a Tab that moved nothing", () => {
    const { input, composer, onSave, onDone } = setup();
    fireEvent.keyDown(input, { key: "Tab" });
    type(input, "New");
    composer.focus();
    expect(document.activeElement).toBe(input);
    expect(onSave).not.toHaveBeenCalled();
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

  it("takes focus back when the dialog holding it closes and focus falls to the body", async () => {
    const { input, onDone } = setup();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = '<button type="button">Pick</button>';
    dialog.querySelector("button")!.focus();
    dialog.remove();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {});
    expect(document.activeElement).toBe(input);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("a dialog that was open before the editor", () => {
  it("is no dialog opened on its own: a menu's closing drawer does not keep the editor from its focus", () => {
    const drawer = document.body.appendChild(document.createElement("div"));
    drawer.setAttribute("role", "dialog");
    drawer.innerHTML = '<button type="button">Rename</button>';
    const { input, onDone } = setup();
    drawer.querySelector("button")!.focus();
    expect(document.activeElement).toBe(input);
    expect(onDone).not.toHaveBeenCalled();
    drawer.remove();
  });
});

describe("leaving the editor", () => {
  it("saves when focus goes into a frame, where a press makes no pointer press on the page", () => {
    const { input, onSave, onDone } = setup();
    type(input, "New");
    const frame = document.body.appendChild(document.createElement("iframe"));
    fireEvent.focusIn(frame);
    expect(onSave).toHaveBeenCalledWith("New");
    expect(onDone).toHaveBeenCalledTimes(1);
    frame.remove();
  });

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
    const focus = vi.spyOn(input, "focus");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    // A backgrounded page may run no focusin: the composer is simply the active element on return.
    vi.spyOn(document, "activeElement", "get").mockReturnValue(composer);
    fireEvent.focus(window);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not grab focus on the blur that leaving the window causes", () => {
    const { input } = setup();
    const focus = vi.spyOn(input, "focus");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.blur(input);
    expect(focus).not.toHaveBeenCalled();
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

  it("holds the focus of a dialog opened since, and an alert dialog, and nothing else", () => {
    document.body.innerHTML = '<div role="dialog"><i id="a"></i></div><div role="alertdialog"><i id="b"></i></div><i id="c"></i>';
    const none = new Set<Element>();
    expect(isHeldByDialog(document.getElementById("a"), none)).toBe(true);
    expect(isHeldByDialog(document.getElementById("b"), none)).toBe(true);
    expect(isHeldByDialog(document.getElementById("c"), none)).toBe(false);
    expect(isHeldByDialog(null, none)).toBe(false);
    expect(isHeldByDialog(document.getElementById("a"), openDialogs())).toBe(false);
    for (const tag of ["iframe", "webview", "embed", "object"]) expect(isInFrame(document.createElement(tag))).toBe(true);
    expect(isInFrame(document.getElementById("c"))).toBe(false);
    document.body.innerHTML = "";
  });
});
