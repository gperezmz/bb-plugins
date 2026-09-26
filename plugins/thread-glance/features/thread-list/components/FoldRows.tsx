// The fold rows (`N older` on a group, `N more child threads` on a family),
// the "+N more" line in Needs attention, and the environment folder row.
import { memo, useState } from "react";
import { experimental_Icon as Icon, experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import type { PluginEnvironmentProvider } from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import { olderRowText } from "../model/labels";
import { rowIndent } from "../model/layout";
import type { EnvironmentRow, LeftOutRow, OlderRow } from "../model/view";
import type { RowController } from "./controller";
import { FlagGlyph } from "./glyphs";
import { RenameEditor } from "./RenameEditor";
import { ROW_ICON_BUTTON } from "./ThreadRowView";

export const OlderRowView = memo(function OlderRowView({ row, controller }: { row: OlderRow; controller: RowController }) {
  const { label, ariaLabel } = olderRowText(row);
  // A family's fold sits where its children do, with a dots glyph in the
  // Status column; the group's fold keeps the chevron.
  const inFamily = row.scope !== "group";
  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      aria-label={ariaLabel}
      onClick={() => controller.onToggleOlder(row)}
      className={cn(
        "relative flex w-full items-center rounded-md pr-2 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        inFamily ? "h-7 gap-1.5 max-md:pointer-coarse:h-9" : "h-6 gap-1",
      )}
      style={{ paddingLeft: rowIndent(row.depth) + (inFamily ? 0 : 2) }}
    >
      {inFamily ? (
        <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center">
          <Icon name={ICONS.more} className="size-3.5" />
        </span>
      ) : (
        <Icon name={ICONS.expand} aria-hidden className={cn("size-3 transition-transform", row.expanded && "-rotate-90")} />
      )}
      {label}
    </button>
  );
});

/** The "+N more" line under a closed family in Needs attention: it opens the family, as the chip does. */
export const LeftOutRowView = memo(function LeftOutRowView({ row, controller }: { row: LeftOutRow; controller: RowController }) {
  const noun = row.count === 1 ? "child thread" : "child threads";
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-label={`Show ${row.count} more ${noun}`}
      title={`Show ${row.count} more ${noun}`}
      onClick={() => controller.onOpenChildren(row.scopeId)}
      className="relative flex h-6 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      style={{ paddingLeft: rowIndent(row.depth) }}
    >
      <span aria-hidden className="size-4 shrink-0" />
      +{row.count} more
    </button>
  );
});

export const EnvironmentRowView = memo(function EnvironmentRowView({
  row,
  controller,
  environmentProviders,
}: {
  row: EnvironmentRow;
  controller: RowController;
  environmentProviders: readonly PluginEnvironmentProvider[];
}) {
  const [renaming, setRenaming] = useState(false);
  const provider =
    row.environmentProviderId === null
      ? null
      : environmentProviders.find((candidate) => candidate.id === row.environmentProviderId) ?? null;
  return (
    <div
      className="group/row relative flex h-7 w-full items-center gap-1.5 rounded-md pr-1 text-sm text-muted-foreground hover:bg-sidebar-accent"
      style={{ paddingLeft: rowIndent(row.depth) }}
    >
      <button
        type="button"
        aria-expanded={!row.collapsed}
        aria-label={`${row.collapsed ? "Expand" : "Collapse"} ${row.label} environment, ${row.threadIds.length} threads`}
        onClick={() => controller.onToggleEnvironment(row.environmentId)}
        className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      />
      <span className="pointer-events-none relative inline-flex size-4 shrink-0 items-center justify-center">
        {provider !== null ? (
          <ProviderIcon providerKind="environment" provider={provider} className="size-3.5" />
        ) : (
          <Icon name={row.environmentProviderId === null ? ICONS.machine : ICONS.environmentFallback} aria-hidden className="size-3.5" />
        )}
      </span>
      {renaming ? (
        <RenameEditor
          initial={row.label}
          label="Environment name"
          onSave={(name) => controller.onRenameEnvironment(row.environmentId, name)}
          onDone={() => setRenaming(false)}
        />
      ) : (
        <span className="pointer-events-none relative min-w-0 flex-1 truncate">{row.label}</span>
      )}
      {row.flag !== null ? <FlagGlyph flag={row.flag} className="pointer-events-none relative size-3.5" /> : null}
      <span className="pointer-events-none relative text-[11px] tabular-nums">{row.threadIds.length}</span>
      <Icon
        name={ICONS.expand}
        aria-hidden
        className={cn("pointer-events-none relative size-3 transition-transform", !row.collapsed && "rotate-90")}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Environment actions"
            className={cn(ROW_ICON_BUTTON, !controller.compact && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100")}
          >
            <Icon name={ICONS.more} aria-hidden className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => controller.onNewThreadInEnvironment(row.environmentId, row.projectId, row.sectionId)}
          >
            <Icon name={ICONS.newThread} aria-hidden className="size-4" />
            New thread in environment
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Icon name={ICONS.rename} aria-hidden className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => controller.onArchiveEnvironment(row.environmentId)}>
            <Icon name={ICONS.archive} aria-hidden className="size-4" />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
