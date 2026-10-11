// The inline title editor. It keeps focus until the user leaves it, with no
// time limit: a pointer press outside it, Tab, Enter or Escape. Focus that
// moves away any other way is taken back, such as bb focusing the composer of
// a thread a double-click's first click opened, however late, or a closing
// menu handing focus to its trigger. Leaving the window is not leaving the
// editor, and a dialog that opens on its own keeps the focus it took; focus
// that goes into a frame is the user pressing in it, so it leaves. Enter and
// leaving save a trimmed, changed title; Escape cancels. The row stays on its
// shelf until the editor ends.
import { useEffect, useRef, useState } from "react";
import { isHeldByDialog, isInFrame, leavesByKey, openDialogs } from "./rename-focus";

export function RenameEditor({
  initial,
  label,
  onSave,
  onDone,
  className,
}: {
  initial: string;
  label: string;
  onSave(title: string): void;
  onDone(): void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // One end per edit: Enter saves and then the unmount's blur must not save again.
  const ended = useRef(false);
  // Set by Tab, so that the blur it causes saves instead of taking focus back.
  const leaving = useRef(false);
  // The latest save, for the document listeners below, which are set up once.
  const save = useRef(() => {});
  const end = (saves: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (saves) onSave(value);
    onDone();
  };
  save.current = () => end(true);

  useEffect(() => {
    const editor = input.current;
    if (editor === null) return;
    const dialogsBefore = openDialogs();
    editor.focus();
    editor.select();
    // Takes focus back unless the user left or a dialog holds it.
    const takeFocusBack = (target: EventTarget | null) => {
      if (ended.current || leaving.current || target === editor || isHeldByDialog(target, dialogsBefore)) return;
      if (isInFrame(target)) save.current();
      else editor.focus();
    };
    const onFocusIn = (event: FocusEvent) => takeFocusBack(event.target);
    const onWindowFocus = () => takeFocusBack(document.activeElement);
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !editor.contains(event.target)) save.current();
    };
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

  return (
    <input
      ref={input}
      aria-label={label}
      value={value}
      data-no-drag=""
      className={className}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => {
        if (leaving.current) end(true);
        // Focus that went to nothing, or left with the window, has no focusin to catch it.
        else if (event.relatedTarget === null && document.hasFocus()) input.current?.focus();
      }}
      onClick={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") end(true);
        else if (event.key === "Escape") end(false);
        // A Tab that moved nothing must not switch the guard off for good.
        else leaving.current = leavesByKey(event);
      }}
    />
  );
}
