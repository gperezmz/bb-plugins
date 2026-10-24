// The child threads listed under a card: one line each with its mark, title and
// status or age, and a disclosure for its own children. A child of another
// project carries its project icon.
import { memo } from "react";
import { experimental_Icon as Icon, ThreadTitle } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { disclosureName } from "../../model/children-chip";
import type { RowView } from "../../model/list-model";
import { ProjectMark } from "../../project/ProjectMark";
import { useProjectColour } from "../../project/use-project-colour";
import { useProjectIds } from "../../project/use-project-ids";
import { useCommands, useHeights, useProject, useRowsOf, useSettings } from "../../store/hooks";
import { ChildMark } from "./ChildMark";
import { RowContextMenu } from "./RowMenu";
import { StatusView } from "./StatusView";
import { useRowStatus } from "./use-row-status";

export function ChildList({ ids, depth, parentProjectId }: { ids: readonly string[]; depth: number; parentProjectId: string }) {
  const children = useRowsOf(ids);
  if (children.length === 0) return null;
  return (
    <ul data-child-list="" className="flex flex-col">
      {children.map((child) => (
        <ChildRow key={child.id} child={child} depth={depth} parentProjectId={parentProjectId} />
      ))}
    </ul>
  );
}

const ChildRow = memo(function ChildRow({ child, depth, parentProjectId }: { child: RowView; depth: number; parentProjectId: string }) {
  const commands = useCommands();
  const heights = useHeights();
  const { childIcon } = useSettings();
  const status = useRowStatus(child);
  const { thread } = child;
  const project = useProject(thread.projectId);
  const projectIds = useProjectIds();
  const colour = useProjectColour(thread.projectId, projectIds);
  const otherProject = thread.projectId !== parentProjectId;
  const name = disclosureName(depth);
  const tinted = child.focused ? "tg-row-open" : child.openElsewhere ? "tg-row-elsewhere" : "";
  return (
    <li data-child-of-thread={thread.parentThreadId ?? undefined} data-child-id={child.id} className="flex flex-col">
      <RowContextMenu thread={thread} disabled={false} dragging={false}>
        <div style={{ height: heights.childRow, paddingLeft: 12 + depth * 12 }} className={cn("group/child relative flex items-center gap-1.5 rounded-md pr-2 text-xs", tinted)}>
          <a
            href={thread.href}
            aria-current={child.focused ? "page" : undefined}
            onClick={(event) => {
              if (event.button !== 0 || event.altKey || event.shiftKey) return;
              event.preventDefault();
              commands.open(child.id, { split: event.ctrlKey || event.metaKey });
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <ChildMark threadId={child.id} providerId={thread.providerId} style={childIcon} />
            {otherProject ? <ProjectMark projectId={thread.projectId} name={project?.name ?? thread.projectId} colour={colour} className="size-3" /> : null}
            <span className={cn("min-w-0 flex-1 truncate", thread.isUnread && "font-semibold", !thread.isUnread && thread.indicator === "none" && "text-muted-foreground")}>
              <ThreadTitle threadId={thread.id} />
            </span>
          </a>
          <StatusView status={status} className="w-auto shrink-0" />
          {child.children === null ? null : (
            <button
              type="button"
              data-no-drag=""
              aria-label={`${name} of ${thread.displayTitle}`}
              aria-expanded={child.expanded}
              title={name}
              onClick={() => commands.setExpanded(child.id, !child.expanded)}
              className="flex h-4 shrink-0 items-center gap-0.5 rounded-md px-1 text-[10px] tabular-nums text-muted-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <span>{child.children.ids.length}</span>
              <Icon name="ChevronRight" aria-hidden className={cn("size-3 transition-transform duration-150", child.expanded && "rotate-90")} />
            </button>
          )}
        </div>
      </RowContextMenu>
      <ChildList ids={child.shownChildIds} depth={depth + 1} parentProjectId={parentProjectId} />
    </li>
  );
});
