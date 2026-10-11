// The inline title editor: Enter or blur saves a trimmed, changed title,
// Escape cancels. The row stays on its shelf until the editor ends.
import { useEffect, useRef, useState } from "react";

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
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
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
      className={className}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => end(true)}
      onClick={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") end(true);
        else if (event.key === "Escape") end(false);
      }}
    />
  );
}
