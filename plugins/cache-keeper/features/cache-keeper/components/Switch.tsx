/**
 * A switch drawn as bb draws its own. A button rather than a native checkbox:
 * bb's composer reverts a checkbox toggled inside it. Its focus ring shows
 * under keyboard focus only, never on a click.
 */
import { cn } from "@/lib/utils";

export function Switch({ checked, disabled = false, labelledBy, onClick }: { checked: boolean; disabled?: boolean; labelledBy: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span className={cn("absolute left-0 top-0.5 size-4 rounded-full bg-background shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}
