import type { ReactNode } from "react";
import { Pill } from "../look/Pill";

/** A labelled form control. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children}
      {hint !== undefined ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const CAN_WRITE = "can write";

/** The mark an account or credential that can write carries wherever it is shown. */
export function CanWrite({ className }: { className?: string }) {
  return (
    <Pill tone="amber" className={className}>
      {CAN_WRITE}
    </Pill>
  );
}
