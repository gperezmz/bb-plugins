// The inline title editor. It keeps focus until the user leaves it, with no
// time limit: a pointer press outside it, Tab, Enter or Escape. Focus that
// moves away any other way is taken back, such as bb focusing the composer of
// a thread a double-click's first click opened, however late, a closing menu
// handing focus to its trigger, or focus falling to nothing as the focused
// item of a closing menu or dialog is removed. Leaving the window is not
// leaving the editor, and a dialog that opens on its own keeps the focus it
// took; focus that goes into a frame is the user pressing in it, so it leaves.
// Enter and leaving save a trimmed, changed title; Escape cancels. The row
// stays on its shelf until the editor ends.
import { useEffect, useRef, useState } from "react";
import { isFocusOnNothing, isHeldByDialog, isInFrame, leavesByKey, openDialogs } from "./rename-focus";

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
  // Takes focus back when it has gone to nothing while the window has it, set up with the guard below.
  const takeFocusFromNothing = useRef(() => {});

  useEffect(() => {
    const editor = input.current;
    if (editor === null) return;
    const dialogsBefore = openDialogs();
    // A menu still open traps focus and pulls it back as the editor takes it;
    // the focusin that pulls back is not fought, or the two would never stop.
    let focusing = false;
    const focusEditor = () => {
      if (focusing) return;
      focusing = true;
      try {
        editor.focus();
      } finally {
        focusing = false;
      }
    };
    focusEditor();
    editor.select();
    // Takes focus back unless the user left or a dialog holds it.
    const takeFocusBack = (target: EventTarget | null) => {
      if (ended.current || leaving.current || target === editor || isHeldByDialog(target, dialogsBefore)) return;
      if (isInFrame(target)) save.current();
      else focusEditor();
    };
    takeFocusFromNothing.current = () => {
      if (isFocusOnNothing()) takeFocusBack(null);
    };
    const onFocusIn = (event: FocusEvent) => takeFocusBack(event.target);
    const onWindowFocus = () => takeFocusBack(document.activeElement);
    // Removing the focused element, such as a closing menu's item, drops focus to the body with no focus event.
    const removals = new MutationObserver(() => takeFocusFromNothing.current());
    removals.observe(document.body, { childList: true, subtree: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !editor.contains(event.target)) save.current();
    };
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      removals.disconnect();
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
        // Focus that went to nothing has no focusin to catch it.
        else if (event.relatedTarget === null) takeFocusFromNothing.current();
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
