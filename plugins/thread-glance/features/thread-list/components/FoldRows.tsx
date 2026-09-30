// The fold rows (a group's settled fold, `N more child threads` in a tree)
// and the environment folder row.
import { memo } from "react";
import { experimental_Icon as Icon, experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import { olderRowText, settledRowText } from "../model/labels";
import { rowIndent } from "../model/layout";
import type { EnvironmentRow, OlderRow, SettledRow } from "../model/view";
import { useCommands, useEnvironmentMenuOpen, useEnvironmentProviderList, useLayout, useRenaming } from "../store/hooks";
import { menuTriggerProps } from "./overlays/trigger";
import { FlagGlyph } from "./glyphs";
import { RenameEditor } from "./RenameEditor";
import { ENVIRONMENT_ROW_HEIGHT, OLDER_ROW_HEIGHT } from "./row-heights";
import { ROW_ICON_BUTTON } from "./ThreadRowView";

export const OlderRowView = memo(function OlderRowView({ row }: { row: OlderRow }) {
  const commands = useCommands();
  const { density } = useLayout();
  const { label, ariaLabel } = olderRowText(row);
  // It sits where the children do, with a dots glyph in the Status column.
  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      aria-label={ariaLabel}
      onClick={() => commands.toggleOlder(row)}
      className={cn(
        "relative flex w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        OLDER_ROW_HEIGHT[density],
      )}
      style={{ paddingLeft: rowIndent(row.depth) }}
    >
      <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center">
        <Icon name={ICONS.more} className="size-3.5" />
      </span>
      {label}
    </button>
  );
});

/** The settled fold: a muted label, a hairline to the row's end, and a chevron. */
export const SettledRowView = memo(function SettledRowView({ row }: { row: SettledRow }) {
  const commands = useCommands();
  const { label, ariaLabel } = settledRowText(row);
  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      aria-label={ariaLabel}
      onClick={() => commands.toggleSettled(row)}
      className="group/settled relative flex h-6 w-full items-center gap-2 rounded-md pr-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:h-9"
      style={{ paddingLeft: rowIndent(0) }}
    >
      <span className="shrink-0 tabular-nums">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-border/60" />
      <Icon name={ICONS.expand} aria-hidden className={cn("size-3 shrink-0 transition-transform duration-150", row.expanded && "rotate-90")} />
    </button>
  );
});

export const EnvironmentRowView = memo(function EnvironmentRowView({ row, groupId }: { row: EnvironmentRow; groupId: string }) {
  const commands = useCommands();
  const { compact, density } = useLayout();
  const environmentProviders = useEnvironmentProviderList();
  const renaming = useRenaming(groupId, row.key);
  const menuOpen = useEnvironmentMenuOpen(groupId, row.key);
  const trigger = menuTriggerProps(
    menuOpen,
    compact,
    (anchor) => commands.openMenu({ kind: "environment", groupId, rowKey: row.key, anchor }),
    commands.closeMenu,
  );
  const provider =
    row.environmentProviderId === null
      ? null
      : environmentProviders.find((candidate) => candidate.id === row.environmentProviderId) ?? null;
  return (
    <div
      className={cn(
        "group/row relative flex w-full items-center gap-1.5 rounded-md pr-1 text-sm text-muted-foreground hover:bg-sidebar-accent",
        ENVIRONMENT_ROW_HEIGHT[density],
      )}
      style={{ paddingLeft: rowIndent(row.depth) }}
    >
      <button
        type="button"
        aria-expanded={!row.collapsed}
        aria-label={`${row.collapsed ? "Expand" : "Collapse"} ${row.label} environment, ${row.threadIds.length} threads`}
        onClick={() => commands.toggleEnvironment(row.environmentId)}
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
          onSave={(name) => commands.renameEnvironment(row.environmentId, name)}
          onDone={commands.endRename}
        />
      ) : (
        <span className="pointer-events-none relative min-w-0 flex-1 truncate">{row.label}</span>
      )}
      {row.flag !== null ? <FlagGlyph flag={row.flag} className="pointer-events-none relative size-3.5" /> : null}
      <span className="pointer-events-none relative text-xs tabular-nums">{row.threadIds.length}</span>
      <Icon
        name={ICONS.expand}
        aria-hidden
        className={cn("pointer-events-none relative size-3 transition-transform", !row.collapsed && "rotate-90")}
      />
      <button
        type="button"
        aria-label="Environment actions"
        {...trigger}
        className={cn(ROW_ICON_BUTTON, !compact && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100")}
      >
        <Icon name={ICONS.more} aria-hidden className="size-4" />
      </button>
    </div>
  );
});
