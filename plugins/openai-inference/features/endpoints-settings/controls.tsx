// The section's few controls, drawn with the classes of bb's own buttons and inputs.
import type { ComponentProps, ReactNode } from "react";

const BUTTON = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  outline: "border border-input bg-transparent hover:bg-state-hover hover:text-foreground",
  ghost: "hover:bg-state-hover hover:text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
} as const;

export function Button({ variant = "outline", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

/** A labelled text input, with what is wrong with it under it. */
export function TextField({
  label,
  error,
  hint,
  id,
  ...props
}: Omit<ComponentProps<"input">, "id"> & { label: string; id: string; error?: string | null; hint?: ReactNode }) {
  const below = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={below}
        className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring read-only:text-muted-foreground disabled:opacity-50"
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
