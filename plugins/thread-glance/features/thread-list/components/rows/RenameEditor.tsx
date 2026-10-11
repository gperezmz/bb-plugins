// The inline title editor: Enter saves a trimmed, changed title, and so does
// a blur once the user has typed or clicked, or 600 ms have passed; a blur
// before then takes focus back. Escape cancels. The row stays on its shelf
// until the editor ends.
import { useEffect, useRef, useState } from "react";

/** How long after it opens the editor takes focus back from anything but the user. */
const GRACE_MS = 600;

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
  // bb focuses the composer of a thread a double-click's first click has just
  // opened, a moment after the editor is up. Until the user types or clicks,
  // focus that leaves the editor is taken back instead of ending the edit.
  const driven = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const drive = () => void (driven.current = true);
    const timer = setTimeout(drive, GRACE_MS);
    document.addEventListener("keydown", drive, true);
    document.addEventListener("pointerdown", drive, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", drive, true);
      document.removeEventListener("pointerdown", drive, true);
    };
  }, []);
  const end = (save: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (save) onSave(value);
    onDone();
  };
  return (
    <input
      ref={input}
      aria-label={label}
      value={value}
      data-no-drag=""
      data-rename-editor=""
      className={className}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => (driven.current ? end(true) : input.current?.focus())}
      onClick={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") end(true);
        else if (event.key === "Escape") end(false);
      }}
    />
  );
}
