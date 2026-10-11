// The thread header's Children button: "Needs you" or "N children" with up to
// three marks, opening a 320 px popover that lists the children. The label is
// dropped on a compact viewport. The popover closes when the thread changes or
// its last child goes away.
import { useState } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { CompactViewportContext } from "@/components/ui/hooks/use-compact-viewport";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { lastActivityAt } from "@/shared/lifecycle";
import { chipMarkIds, ChildMark, statusSlot, StatusView, Tip, useServerSettings } from "../thread-list";
import { childrenLabel, directChildren } from "./model";

function ChildItem({ child, onOpen }: { child: PluginSidebarThread; onOpen(): void }) {
  const { childIcon } = useServerSettings();
  const status = statusSlot({
    hasPendingInteraction: child.hasPendingInteraction,
    queuedWork: child.queuedWork,
    indicator: child.indicator,
    indicatorLabel: child.indicatorLabel,
    hasDraft: false,
    workingSince: null,
    lastActivityAt: lastActivityAt(child),
    now: Date.now(),
  });
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChildMark threadId={child.id} providerId={child.providerId} style={childIcon} />
        <span className={cn("min-w-0 flex-1 truncate", child.isUnread && "font-semibold")}>{child.displayTitle}</span>
        <StatusView status={status} className="w-auto shrink-0" />
      </button>
    </li>
  );
}

export function ChildrenButton(props: PluginThreadHeaderActionProps) {
  const { threads } = useSidebarThreads();
  const settings = useServerSettings();
  const children = directChildren(threads, props.threadId, settings);
  // Keyed by thread, and gone with the last child: the popover starts closed again for either.
  return children.length === 0 ? null : <ChildrenPopover key={props.threadId} {...props} childThreads={children} />;
}

function ChildrenPopover({ isCompactViewport, childThreads: children }: PluginThreadHeaderActionProps & { childThreads: readonly PluginSidebarThread[] }) {
  const navigate = useBbNavigate();
  const settings = useServerSettings();
  const [open, setOpen] = useState(false);
  const label = childrenLabel(children);
  const marks = chipMarkIds(children.map((child) => child.id));
  return (
    <CompactViewportContext.Provider value={isCompactViewport}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tip label={`${children.length} child thread${children.length === 1 ? "" : "s"}`} side="bottom">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full border border-border px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                open && "bg-accent text-foreground",
              )}
            >
              <span className="flex items-center -space-x-1">
                {marks.map((id) => {
                  const child = children.find((candidate) => candidate.id === id)!;
                  return <ChildMark key={id} threadId={id} providerId={child.providerId} style={settings.childIcon} />;
                })}
              </span>
              {isCompactViewport ? null : <span className="truncate">{label}</span>}
            </button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent
          role="region"
          aria-label="Child threads"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col overflow-hidden p-0"
        >
          <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1">
            <span className="text-xs font-semibold">Children</span>
            <span className="ml-auto text-xs text-muted-foreground">{children.length}</span>
          </div>
          <ul className="min-h-0 overflow-y-auto pb-1">
            {children.map((child) => (
              <ChildItem
                key={child.id}
                child={child}
                onOpen={() => {
                  setOpen(false);
                  navigate.toThread(child.id);
                }}
              />
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </CompactViewportContext.Provider>
  );
}
