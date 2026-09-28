/**
 * Where focus goes as the composer chip's popover opens: on its first
 * control when opened from the keyboard, so keyboard users land inside it;
 * on none of its controls when opened with a pointer, so nothing in it shows
 * a focus ring.
 */
export type OpenedWith = "pointer" | "keyboard";

export function focusOnOpen(openedWith: OpenedWith): "first control" | "popover" {
  return openedWith === "keyboard" ? "first control" : "popover";
}
