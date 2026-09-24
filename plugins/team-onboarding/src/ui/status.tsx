// Status visuals. Colours tell the story, not the state: a fresh setup is
// grey with one blue button, `broken` is red, updates and approvals amber,
// and an offline machine is dimmed, never red.
import type { Status } from "../core/vocab.js";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<Status, string> = {
  ok: "Done",
  todo: "To do",
  broken: "Broken",
  update: "Update",
  "needs-approval": "Needs approval",
  unknown: "Can't check",
  skipped: "Not needed",
};

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const base = cn("size-4 shrink-0", className);
  switch (status) {
    case "ok":
      return <Icon name="CircleCheck" className={cn(base, "text-success")} aria-label="Done" />;
    case "todo":
      return (
        <span
          role="img"
          aria-label="To do"
          className={cn(base, "inline-block rounded-full border-[1.5px] border-muted-foreground/60")}
        />
      );
    case "broken":
      return <Icon name="CircleX" className={cn(base, "text-destructive")} aria-label="Broken" />;
    case "update":
      return <Icon name="ArrowUpRight" className={cn(base, "text-attention")} aria-label="Update" />;
    case "needs-approval":
      return <Icon name="AlertCircle" className={cn(base, "text-attention")} aria-label="Needs approval" />;
    case "unknown":
      return <Icon name="CircleQuestion" className={cn(base, "text-muted-foreground/50")} aria-label="Can't check" />;
    case "skipped":
      return <Icon name="Minus" className={cn(base, "text-muted-foreground/50")} aria-label="Not needed" />;
  }
}

export function statusText(status: Status): string {
  switch (status) {
    case "broken":
      return "text-destructive";
    case "update":
    case "needs-approval":
      return "text-attention";
    case "ok":
      return "text-success";
    default:
      return "text-muted-foreground";
  }
}

export function MachineChip({
  name,
  status,
  isServer,
  title,
}: {
  name: string;
  status: Status;
  isServer: boolean;
  title: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-40 items-center gap-1 rounded-full border border-border px-1.5 text-[11px] leading-none",
        status === "unknown" || status === "skipped" ? "opacity-60" : "",
      )}
    >
      <StatusIcon status={status} className="size-3" />
      <span className="truncate">{name}</span>
      {isServer ? <span className="text-muted-foreground">server</span> : null}
    </span>
  );
}

/** The header's progress ring. */
export function ProgressRing({ done, total, size = 18 }: { done: number; total: number; size?: number }) {
  const radius = (size - 3) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 1 : done / total;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={2.5} className="stroke-border" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        className={fraction >= 1 ? "stroke-success" : "stroke-primary"}
      />
    </svg>
  );
}
