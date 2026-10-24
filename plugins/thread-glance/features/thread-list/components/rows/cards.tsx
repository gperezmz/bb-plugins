// What a row draws inside its frame, by card kind: the Full card's three
// lines, the Folded card's one, and the Slim row's one with the shelf's label
// and restore button. The frame (stripe, link, sweep, menus) is `ThreadRow`.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RowView } from "../../model/list-model";
import type { ProjectColour } from "../../model/project-colour";
import { restoreAction, shelfLabel } from "../../model/shelf-label";
import type { StatusSlot } from "../../model/status-slot";
import { ProjectMark, ProjectName } from "../../project/ProjectMark";
import { useCommands, useNow } from "../../store/hooks";
import { ChildrenChip } from "./ChildrenChip";
import { HarnessLogo } from "./HarnessLogo";
import { HoverActions, offersHoverActions } from "./HoverActions";
import { JumpHint, useJumpHint } from "./jump-hints";
import { Location } from "./Location";
import { PortIndicator } from "./PortIndicator";
import { PullRequestBadge } from "./PullRequestBadge";
import { MoreButton } from "./RowMenu";
import { RenameEditor } from "./RenameEditor";
import { CompactStatusView, StatusView } from "./StatusView";
import { Tip } from "./Tip";
import { useRowStatus } from "./use-row-status";

interface CardProps {
  row: RowView;
  editing: boolean;
  projectName: string;
  colour: ProjectColour | null;
}

export function Cards(props: CardProps) {
  switch (props.row.card) {
    case "full":
      return <FullCard {...props} />;
    case "folded":
      return <FoldedCard {...props} />;
    case "slim":
      return <SlimRow {...props} />;
  }
}

// ——— Shared parts ———

/** The title: bold when unread or woke, muted for a read idle thread; the editor while it is renamed. */
function Title({ row, editing, className, editorClassName }: { row: RowView; editing: boolean; className?: string; editorClassName?: string }) {
  const commands = useCommands();
  const { thread } = row;
  if (editing) {
    return (
      <RenameEditor
        initial={thread.displayTitle}
        label={`Rename ${thread.displayTitle}`}
        onSave={(title) => void commands.rename(thread.id, title)}
        onDone={commands.endRename}
        className={cn("pointer-events-auto relative min-w-0 flex-1 rounded-md bg-background px-1 text-sm outline-none ring-1 ring-sidebar-ring", editorClassName)}
      />
    );
  }
  const bold = row.woke !== null || thread.isUnread;
  const muted = !bold && thread.indicator === "none";
  return (
    <span data-title="" className={cn("min-w-0 flex-1 truncate text-sm", bold && "font-semibold", muted && "text-muted-foreground", className)}>
      {thread.displayTitle}
    </span>
  );
}

const SMALL_BUTTON =
  "pointer-events-auto flex h-5 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function UnpinButton({ row, className }: { row: RowView; className?: string }) {
  const commands = useCommands();
  if (!row.thread.isPinned) return null;
  return (
    <Tip label="Unpin thread">
      <button
        type="button"
        data-no-drag=""
        aria-label={`Unpin ${row.thread.displayTitle}`}
        onClick={(event) => {
          event.stopPropagation();
          void commands.unpin(row.id);
        }}
        className={cn(
          "pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          className,
        )}
      >
        <Icon name="PinOff" aria-hidden className="size-3.5" />
      </button>
    </Tip>
  );
}

function WokeMarker({ row }: { row: RowView }) {
  const commands = useCommands();
  return (
    <span data-woke="" className="flex shrink-0 items-center gap-0.5">
      <span className="text-[10px] font-semibold text-[color:var(--tg-working)]">Woke</span>
      <Tip label="Dismiss Woke marker">
        <button
          type="button"
          data-no-drag=""
          aria-label="Dismiss Woke marker"
          onClick={(event) => {
            event.stopPropagation();
            void commands.dismissWoke(row.id);
          }}
          className="pointer-events-auto flex size-4 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Icon name="X" aria-hidden className="size-3" />
        </button>
      </Tip>
    </span>
  );
}

/**
 * The Status slot (80 px, right-aligned): one thing, or the jump hint while the
 * modifier is held, which widens the slot where bb's label is longer. On hover
 * a card that is not busy and not woke swaps it for Snooze and Settle, and
 * every card for Unpin and the thread menu. On touch there is no hover, so
 * Unpin stays beside the status.
 */
function StatusCell({ row, status, compact }: { row: RowView; status: StatusSlot; compact?: boolean }) {
  const hint = useJumpHint(row.id);
  const title = row.thread.displayTitle;
  const woke = row.woke !== null;
  return (
    <div data-status-slot="" className={cn("pointer-events-none relative flex h-5 shrink-0 items-center justify-end", hint !== null ? "min-w-20" : "w-20")}>
      <div
        className={cn(
          "flex min-w-0 items-center justify-end gap-1 transition-opacity duration-150 motion-reduce:transition-none",
          !woke && "[@media(hover:hover)]:group-hover/card:opacity-0 [@media(hover:hover)]:group-focus-within/card:opacity-0",
        )}
      >
        <UnpinButton row={row} className="[@media(hover:hover)]:hidden" />
        {hint !== null ? <JumpHint label={hint} /> : woke ? <WokeMarker row={row} /> : compact ? <CompactStatusView status={status} /> : <StatusView status={status} />}
      </div>
      <div
        data-slot-actions=""
        className={cn(
          "absolute inset-y-0 right-0 hidden items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
          "[@media(hover:hover)]:flex [@media(hover:hover)]:group-hover/card:opacity-100 [@media(hover:hover)]:group-focus-within/card:opacity-100",
          woke && "static ml-0.5 [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover/card:flex",
        )}
      >
        <UnpinButton row={row} />
        {offersHoverActions(row) ? <HoverActions threadId={row.id} title={title} /> : null}
        <MoreButton thread={row.thread} />
      </div>
    </div>
  );
}

function Counts({ row }: { row: RowView }) {
  const { activity } = row.thread;
  return (
    <>
      {activity.workflows > 0 ? (
        <span aria-label={`${activity.workflows} workflows`} className="shrink-0 rounded bg-muted px-1 font-mono text-[10px]">
          {activity.workflows}
        </span>
      ) : null}
      {activity.backgroundAgents > 0 ? (
        <span aria-label={`${activity.backgroundAgents} background agents`} className="shrink-0 rounded bg-muted px-1 font-mono text-[10px]">
          {activity.backgroundAgents}
        </span>
      ) : null}
    </>
  );
}

// ——— The three cards ———

// Each card's lines sit over the row link, which is the whole card's hit area:
// they pass the pointer through, and a button in them takes it back with
// `pointer-events-auto`.

function FullCard({ row, editing, projectName, colour }: CardProps) {
  const status = useRowStatus(row);
  const { thread } = row;
  const slot = <StatusCell row={row} status={status} />;
  const lineThree = (
    <div className="pointer-events-none relative flex h-[18px] items-center gap-1.5 text-[10px] text-muted-foreground">
      <Location thread={thread} />
      {row.children === null ? null : <ChildrenChip parentId={row.id} info={row.children} expanded={row.expanded} />}
      {thread.environment?.branchName && thread.host ? (
        <Icon name="Computer" aria-label={`Machine: ${thread.host.name}`} className="size-3 shrink-0 text-muted-foreground/60" />
      ) : null}
      <PortIndicator environmentId={thread.environment?.id} />
      <Counts row={row} />
      <PullRequestBadge environmentId={thread.environment?.id} />
      <HarnessLogo providerId={thread.providerId} />
    </div>
  );
  if (row.grouped) {
    return (
      <div className="pointer-events-none relative flex flex-col gap-0.5">
        <div className="pointer-events-none flex h-5 items-center gap-1.5">
          <Title row={row} editing={editing} />
          {slot}
        </div>
        {lineThree}
      </div>
    );
  }
  return (
    <div className="pointer-events-none relative flex flex-col gap-0.5">
      <div className="pointer-events-none flex h-[18px] items-center gap-1.5 text-[10px] font-medium">
        <ProjectMark projectId={thread.projectId} name={projectName} colour={colour} className="size-3" />
        <ProjectName name={projectName} colour={colour} className="min-w-0 flex-1 truncate" />
        {slot}
      </div>
      <div className="pointer-events-none flex h-5 items-center">
        <Title row={row} editing={editing} />
      </div>
      {lineThree}
    </div>
  );
}

function FoldedCard({ row, editing, projectName, colour }: CardProps) {
  const status = useRowStatus(row);
  const { thread } = row;
  return (
    <div className="pointer-events-none relative flex h-full items-center gap-1.5 text-xs">
      <ProjectMark projectId={thread.projectId} name={projectName} colour={colour} className="size-3" />
      {/* Squeezed first, then the chip's marks, so the title keeps `min-w-12` of the one line. */}
      <ProjectName name={projectName} colour={colour} className="max-w-[40%] shrink-[4] truncate" />
      <span aria-hidden className="shrink-0 text-muted-foreground/60">
        ·
      </span>
      <Title row={row} editing={editing} className="min-w-12 text-xs" />
      {row.children === null ? null : <ChildrenChip parentId={row.id} info={row.children} expanded={row.expanded} />}
      <PortIndicator environmentId={thread.environment?.id} />
      <StatusCell row={row} status={status} compact />
    </div>
  );
}

function SlimRow({ row, editing, projectName, colour }: CardProps) {
  const commands = useCommands();
  const now = useNow();
  const status = useRowStatus(row);
  const hint = useJumpHint(row.id);
  const { thread } = row;
  const label = shelfLabel(row, now);
  const restore = restoreAction(row.shelf);
  const settled = row.shelf === "settled";
  let right: ReactNode = null;
  if (hint !== null) right = <JumpHint label={hint} className="[@media(hover:hover)]:group-focus-within/card:hidden" />;
  else if (settled) right = <StatusView status={status} className="w-auto" />;
  else if (label !== null) right = <span className="min-w-0 truncate text-[10px] text-muted-foreground tabular-nums">{label}</span>;
  // The jump hint keeps its width, so its key is never cut: while it shows, the title has no floor and the hover buttons give way, unless one holds focus, and then the hint gives way to them.
  const squeezable = hint === null && right !== null;
  return (
    <div className="@container pointer-events-none relative flex h-full items-center gap-1.5 text-xs">
      <ProjectMark projectId={thread.projectId} name={projectName} colour={colour} className="size-3" />
      {/* From 200 px of row, the project name gives way first, then the label or status, then the title down to `min-w-12`, so the chip and the buttons stay whole at bb's default sidebar width. The shrink factors are far apart so a later part loses nothing while an earlier one has width to give. Below 200 px nothing keeps its width: the chip and the title shrink, so the row never overflows. */}
      <span className="max-w-[40%] min-w-0 shrink-[10000] truncate">
        <ProjectName name={projectName} colour={colour} />
        <span aria-hidden className="text-muted-foreground/60">
          {" ·"}
        </span>
      </span>
      <Title
        row={row}
        editing={editing}
        className={cn("min-w-0 shrink-[3] basis-12 text-xs", hint === null && "@min-[200px]:min-w-12")}
        editorClassName={cn("shrink-[3] basis-12", hint === null && "@min-[200px]:min-w-12")}
      />
      {row.children === null ? null : <ChildrenChip parentId={row.id} info={row.children} expanded={row.expanded} className="shrink-[5] @min-[200px]:shrink-0" />}
      {squeezable ? <span className="flex min-w-0 shrink justify-end overflow-hidden whitespace-nowrap">{right}</span> : right}
      <span
        data-slim-actions=""
        className={cn(
          "flex shrink-0 items-center gap-0.5 [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover/card:flex [@media(hover:hover)]:group-focus-within/card:flex",
          hint !== null && "[@media(hover:hover)]:group-hover/card:not-focus-within:hidden",
        )}
      >
        {restore === null ? null : (
          <button
            type="button"
            data-no-drag=""
            aria-label={restore.name}
            onClick={(event) => {
              event.stopPropagation();
              void commands[restore.command](row.id);
            }}
            className={SMALL_BUTTON}
          >
            {restore.text}
          </button>
        )}
        <span className="[@media(hover:none)]:hidden">
          <MoreButton thread={thread} />
        </span>
      </span>
    </div>
  );
}
