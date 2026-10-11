// The Hover card's "Workspace ports (N)": every listener in the thread's
// environment with its port and process, scrolling beyond four. Stop asks
// twice: the first press arms the entry, and the armed state ends after 4 s,
// when focus leaves the button, or when a press lands anywhere else in the
// section. Entries only Docker reports have no Stop. Pointer hover and
// keyboard focus open the card, so touch has the indicator and nothing more.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { listenerKey, portLinkHref, processLabel, stopTarget } from "../../model/ports";
import { useCommands } from "../../store/hooks";
import { usePortEnvironment } from "../../sync/hooks";
import { usePortLinkMachine } from "../../storage/port-link-machine";
import type { PortListener } from "@/shared/ports";

/** How long a Stop stays armed before it needs a first press again, ms. */
export const STOP_ARMED_MS = 4_000;

/** The entries shown before the list scrolls. */
const VISIBLE_ENTRIES = 4;
/**
 * One entry's height, in bb's spacing unit as `h-6` would give it. The list's
 * cap is the same unit times the entries, so it holds four whatever bb sets
 * the unit to.
 */
export const ENTRY_HEIGHT = "calc(var(--spacing) * 6)";
export const LIST_MAX_HEIGHT = `calc(var(--spacing) * ${6 * VISIBLE_ENTRIES})`;

const STOP_BUTTON =
  "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring";

function Entry({
  threadId,
  listener,
  href,
  armed,
  onArm,
  onDisarm,
}: {
  threadId: string;
  listener: PortListener;
  href: string | null;
  armed: boolean;
  onArm(): void;
  onDisarm(): void;
}) {
  const commands = useCommands();
  const target = stopTarget(listener);
  const process = processLabel(listener);
  const port = `:${listener.port}`;
  return (
    <li data-port-entry={listener.port} style={{ height: ENTRY_HEIGHT }} className="flex min-w-0 shrink-0 items-center gap-2">
      {href === null ? (
        <span className="font-mono tabular-nums">{port}</span>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono tabular-nums hover:underline">
          {port}
        </a>
      )}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{process}</span>
      {target === null ? null : (
        <button
          type="button"
          data-stop-armed={armed ? "" : undefined}
          aria-label={armed ? `Confirm stopping ${process ?? "the process"} on port ${listener.port}` : `Stop ${process ?? "the process"} on port ${listener.port}`}
          onClick={() => {
            if (!armed) {
              onArm();
              return;
            }
            onDisarm();
            void commands.stopPort(threadId, target);
          }}
          onBlur={() => armed && onDisarm()}
          className={cn(STOP_BUTTON, armed ? "bg-[color:var(--tg-failed)] text-white" : "text-muted-foreground hover:text-foreground")}
        >
          {armed ? "Confirm stop" : "Stop"}
        </button>
      )}
    </li>
  );
}

export function PortsSection({ threadId, environmentId }: { threadId: string; environmentId: string | null | undefined }) {
  const environment = usePortEnvironment(environmentId);
  const machineId = usePortLinkMachine();
  const [armedKey, setArmedKey] = useState<string | null>(null);
  useEffect(() => {
    if (armedKey === null) return;
    const timer = setTimeout(() => setArmedKey(null), STOP_ARMED_MS);
    return () => clearTimeout(timer);
  }, [armedKey]);
  if (environment === null || environment.listeners.length === 0) return null;
  return (
    <div
      data-section="ports"
      className="flex flex-col gap-0.5"
      onPointerDown={(event) => {
        if (!(event.target as Element).closest("[data-stop-armed]")) setArmedKey(null);
      }}
    >
      <span className="font-medium">Workspace ports ({environment.listeners.length})</span>
      <ul data-ports-list="" style={{ maxHeight: LIST_MAX_HEIGHT }} className="flex flex-col overflow-y-auto">
        {environment.listeners.map((listener) => {
          const key = listenerKey(listener);
          return (
            <Entry
              key={key}
              threadId={threadId}
              listener={listener}
              href={portLinkHref(listener, environment.hostId, machineId)}
              armed={armedKey === key}
              onArm={() => setArmedKey(key)}
              onDisarm={() => setArmedKey((current) => (current === key ? null : current))}
            />
          );
        })}
      </ul>
    </div>
  );
}
