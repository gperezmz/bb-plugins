// The seam a thread's row hangs on. One memoized `ThreadRow` per thread id
// reads its own `RowView` from the store, so it renders when its thread's row
// changes and at no other time. This is a plain stand-in for the full card,
// the folded card and the slim row: the project and title, the shelf's label
// and its restore button. A card draws the same props in its own layout and
// calls `useCardDrawn` while it is on screen.
import { memo, useEffect } from "react";
import { useSidebarThreadSplit } from "./use-split";
import { cn } from "@/lib/utils";
import { cardHeight } from "../../model/layout";
import { snoozeWakeLabel } from "@/shared/snooze";
import {
  useCommands,
  useHeights,
  useIsRenaming,
  useMinute,
  useProject,
  useRow,
  useRowsOf,
} from "../../store/hooks";
import type { RowView } from "../../model/list-model";
import { registerCard, useIsSweeping } from "../../commands/sweep";
import { RenameEditor } from "./RenameEditor";

const DAY_MS = 86_400_000;

/** The slim shelves' label: "Waiting Nd" on Parked, the wake time on Snoozed. */
export function shelfLabel(row: RowView, now: number): string | null {
  if (row.shelf === "parked" && row.lifecycle?.parkedAt != null) {
    return `Waiting ${Math.max(0, Math.floor((now - row.lifecycle.parkedAt) / DAY_MS))}d`;
  }
  if (row.shelf === "snoozed" && row.lifecycle?.snoozeUntil != null) return snoozeWakeLabel(row.lifecycle.snoozeUntil, now);
  return null;
}

/**
 * A card calls this while it is on screen, so the Settle sweep plays on it
 * from whichever entry point settles the thread.
 */
export function useCardDrawn(threadId: string, drawn: boolean): void {
  useEffect(() => (drawn ? registerCard(threadId) : undefined), [threadId, drawn]);
}

const BUTTON = "h-6 shrink-0 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export const ThreadRow = memo(function ThreadRow({ threadId }: { threadId: string }) {
  const row = useRow(threadId);
  const commands = useCommands();
  const editing = useIsRenaming(threadId);
  const sweeping = useIsSweeping(threadId);
  const minute = useMinute();
  const project = useProject(row?.thread.projectId ?? "");
  const heights = useHeights();
  const split = useSidebarThreadSplit(threadId);
  useCardDrawn(threadId, row !== undefined && row.card !== "slim");
  if (row === undefined) return null;
  const { thread } = row;
  const now = minute * 60_000;
  const label = shelfLabel(row, now);
  const tinted = row.focused ? "tg-row-open" : row.openElsewhere ? "tg-row-elsewhere" : "";
  const restore =
    row.shelf === "parked"
      ? { name: "Resume thread", run: () => void commands.resume(threadId) }
      : row.shelf === "snoozed"
        ? { name: "Wake thread now", run: () => void commands.wakeNow(threadId) }
        : row.shelf === "settled"
          ? { name: "Un-settle thread", run: () => void commands.unsettle(threadId) }
          : null;
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div
        data-thread-id={threadId}
        data-card={row.card}
        data-shelf-of={row.shelf ?? undefined}
        data-focused={row.focused ? "" : undefined}
        data-open-elsewhere={row.openElsewhere ? "" : undefined}
        style={{ height: cardHeight(row.card, heights) }}
        className={cn("relative flex min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-sm", tinted)}
      >
        {editing ? (
          <RenameEditor
            initial={thread.displayTitle}
            label={`Rename ${thread.displayTitle}`}
            onSave={(title) => void commands.rename(threadId, title)}
            onDone={commands.endRename}
            className="min-w-0 flex-1 rounded-md bg-transparent px-1 outline-none ring-1 ring-sidebar-ring"
          />
        ) : (
          <a
            href={thread.href}
            {...split.splitProps}
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            aria-current={row.focused ? "page" : undefined}
            onClick={(event) => {
              if (event.button !== 0 || event.altKey || event.shiftKey) return;
              event.preventDefault();
              commands.open(threadId, { split: event.ctrlKey || event.metaKey });
            }}
            onDoubleClick={() => commands.beginRename(threadId)}
            className={cn("flex min-w-0 flex-1 items-center gap-1 truncate outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", row.woke !== null && "font-semibold")}
          >
            <span className="shrink-0 text-muted-foreground">{project?.name ?? ""}</span>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span className="min-w-0 truncate">{thread.displayTitle}</span>
          </a>
        )}
        {row.woke !== null ? (
          <>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Woke</span>
            <button type="button" aria-label="Dismiss Woke marker" className={BUTTON} onClick={() => void commands.dismissWoke(threadId)}>
              ×
            </button>
          </>
        ) : null}
        {label !== null ? <span className="shrink-0 text-xs text-muted-foreground">{label}</span> : null}
        {restore !== null ? (
          <button type="button" aria-label={restore.name} className={BUTTON} onClick={restore.run}>
            {restore.name}
          </button>
        ) : null}
        {sweeping ? <span aria-hidden data-sweep="" className="tg-sweep" /> : null}
      </div>
      <ChildList ids={row.shownChildIds} depth={0} />
    </div>
  );
});

/** The children listed under a card: a stand-in line each, with their own lists below. */
function ChildList({ ids, depth }: { ids: readonly string[]; depth: number }) {
  const children = useRowsOf(ids);
  if (children.length === 0) return null;
  return (
    <ul className="flex flex-col">
      {children.map((child) => (
        <ChildRow key={child.id} child={child} depth={depth} />
      ))}
    </ul>
  );
}

const ChildRow = memo(function ChildRow({ child, depth }: { child: RowView; depth: number }) {
  const commands = useCommands();
  const heights = useHeights();
  return (
    <li data-child-of-thread={child.thread.parentThreadId ?? undefined} className="flex flex-col">
      <div style={{ height: heights.childRow, paddingLeft: 12 + depth * 12 }} className="flex items-center text-xs text-muted-foreground">
        <button type="button" className="min-w-0 truncate text-left" onClick={() => commands.open(child.id)}>
          {child.thread.displayTitle}
        </button>
      </div>
      <ChildList ids={child.shownChildIds} depth={depth + 1} />
    </li>
  );
});
