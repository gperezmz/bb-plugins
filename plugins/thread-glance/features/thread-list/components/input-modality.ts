// Which input moved focus last, keyboard or pointer, written on the list's
// root as `data-input-modality`. Rows and group headers show their hover
// actions for focus inside them only under `keyboard`, so a click that leaves
// focus in a row does not keep its hover look once the pointer leaves.
// `:focus-visible` says the same, but Chromium drops focus on Tab from a row's
// link when the actions it would reach are shown by `:has(:focus-visible)`.
import { useEffect, type RefObject } from "react";

export type InputModality = "keyboard" | "pointer";

/** The modality an event starts, or null for one that changes nothing. */
export function modalityOf(event: { type: string; key?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): InputModality | null {
  if (event.type === "pointerdown") return "pointer";
  if (event.type !== "keydown") return null;
  // A shortcut or a lone modifier does not move focus, as Chromium's own
  // `:focus-visible` treats them.
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "Shift" || event.key === "Meta" || event.key === "Control" || event.key === "Alt") return null;
  return "keyboard";
}

/** Keeps `data-input-modality` on the element current for the whole document. */
export function useInputModality(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onInput = (event: Event) => {
      const modality = modalityOf(event as KeyboardEvent);
      if (modality !== null) root.current?.setAttribute("data-input-modality", modality);
    };
    document.addEventListener("keydown", onInput, true);
    document.addEventListener("pointerdown", onInput, true);
    return () => {
      document.removeEventListener("keydown", onInput, true);
      document.removeEventListener("pointerdown", onInput, true);
    };
  }, [root]);
}
