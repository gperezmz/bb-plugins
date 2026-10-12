import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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

/** One choice of a radio group, with the words that describe it beside it. */
export function Choice({ name, value, checked, onChange, label, children, disabled = false }: { name: string; value: string; checked: boolean; onChange(): void; label: string; children?: ReactNode; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 has-[:checked]:border-foreground">
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="mt-1" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {children}
      </span>
    </label>
  );
}

const CAN_WRITE = "can write";

/** The mark an account or credential that can write carries wherever it is shown. */
export function CanWrite({ className }: { className?: string }) {
  return <span className={cn("rounded bg-warning/15 px-1 text-xs text-warning", className)}>{CAN_WRITE}</span>;
}
