// The list header: the grouping's name, the need-you filter, Mark all read
// and the settings button, above every group.
import { memo, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ClientPreferences, OrganizationMode, Preferences } from "@/shared/preferences";
import { ICONS } from "../icons";
import { groupingName } from "../model/labels";
import { SettingsPanel } from "./SettingsPanel";
import { ROW_ICON_BUTTON } from "./ThreadRowView";

// bb's attention colour, thinned, as the need-you filter's own: the list's
// one place to see what waits on you.
const NEED_YOU =
  "bg-[color-mix(in_oklab,var(--attention)_14%,transparent)] text-[color:color-mix(in_oklab,var(--attention),var(--foreground)_55%)] hover:bg-[color-mix(in_oklab,var(--attention)_24%,transparent)]";
const NEED_YOU_ON = "bg-[color-mix(in_oklab,var(--attention)_30%,transparent)] text-foreground";

export interface ListHeaderProps {
  mode: OrganizationMode;
  /** Thread trees that need attention; the filter is not drawn at 0. */
  needYouCount: number;
  needYouOnly: boolean;
  onToggleNeedYou(): void;
  /** A thread in the list is unread; Mark all read is not drawn otherwise. */
  hasUnread: boolean;
  onMarkAllRead(): void;
  prefs: Preferences;
  client: ClientPreferences;
  onPrefs(patch: Partial<Preferences>): void;
  onClient(patch: Partial<ClientPreferences>): void;
}

export const ListHeader = memo(function ListHeader({
  mode,
  needYouCount,
  needYouOnly,
  onToggleNeedYou,
  hasUnread,
  onMarkAllRead,
  prefs,
  client,
  onPrefs,
  onClient,
}: ListHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div
      data-sidebar="list-header"
      className="flex h-7 items-center gap-1 pl-2 pr-1 text-xs text-muted-foreground max-md:pointer-coarse:h-9"
    >
      <h2 className="min-w-0 flex-1 truncate font-medium select-none">{groupingName(mode)}</h2>
      {needYouCount > 0 ? (
        <button
          type="button"
          aria-pressed={needYouOnly}
          title={needYouOnly ? "Show every thread" : "Show only what needs you"}
          onClick={onToggleNeedYou}
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            needYouOnly ? NEED_YOU_ON : NEED_YOU,
          )}
        >
          {needYouCount} need you
        </button>
      ) : null}
      {hasUnread ? (
        <button type="button" aria-label="Mark all read" title="Mark all read" className={ROW_ICON_BUTTON} onClick={onMarkAllRead}>
          <Icon name={ICONS.markRead} aria-hidden className="size-4" />
        </button>
      ) : null}
      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Thread Glance settings" title="Settings" className={ROW_ICON_BUTTON}>
            <Icon name={ICONS.settings} aria-hidden className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-80 max-w-[calc(100vw-1rem)] p-1">
          <SettingsPanel prefs={prefs} client={client} onPrefs={onPrefs} onClient={onClient} />
        </PopoverContent>
      </Popover>
    </div>
  );
});
