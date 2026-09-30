// The list header: the grouping's name, the need-you filter, Mark all read
// and the settings button, above every group.
import { memo, useEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import { groupingName } from "../model/labels";
import { useClient, useCommands, useLayout, useListHasUnread, useNeedYouCount, useNeedYouOn, usePrefs } from "../store/hooks";
import { SettingsPanel } from "./SettingsPanel";
import { ROW_ICON_BUTTON } from "./ThreadRowView";

// bb's attention colour, thinned, as the need-you filter's own: the list's
// one place to see what waits on you.
const NEED_YOU =
  "bg-[color-mix(in_oklab,var(--attention)_14%,transparent)] text-[color:color-mix(in_oklab,var(--attention),var(--foreground)_55%)] hover:bg-[color-mix(in_oklab,var(--attention)_24%,transparent)]";
const NEED_YOU_ON = "bg-[color-mix(in_oklab,var(--attention)_30%,transparent)] text-foreground";

/** The list header. It reads only what it draws, so it renders when a count or flag it shows changes. */
export const ListHeader = memo(function ListHeader() {
  const commands = useCommands();
  const { mode, compact } = useLayout();
  // Thread trees that need attention; the filter is not drawn at 0.
  const needYouCount = useNeedYouCount();
  const needYouOnly = useNeedYouOn();
  // A thread in the list is unread; Mark all read is not drawn otherwise.
  const hasUnread = useListHasUnread();
  const prefs = usePrefs();
  const client = useClient();
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settings = useSettingsPopover(settingsButton, !compact);
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
          onClick={commands.toggleNeedYou}
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            needYouOnly ? NEED_YOU_ON : NEED_YOU,
          )}
        >
          {needYouCount} need you
        </button>
      ) : null}
      {hasUnread ? (
        <button type="button" aria-label="Mark all read" title="Mark all read" className={ROW_ICON_BUTTON} onClick={commands.markListRead}>
          <Icon name={ICONS.markRead} aria-hidden className="size-4" />
        </button>
      ) : null}
      <Popover open={settings.open} onOpenChange={settings.onOpenChange}>
        <PopoverTrigger asChild>
          <button ref={settingsButton} type="button" aria-label="Thread Glance settings" title="Settings" className={ROW_ICON_BUTTON}>
            <Icon name={ICONS.settings} aria-hidden className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-80 max-w-[calc(100vw-1rem)] p-1" {...settings.contentProps}>
          <SettingsPanel prefs={prefs} client={client} onPrefs={commands.updatePreferences} onClient={commands.updateClient} />
        </PopoverContent>
      </Popover>
    </div>
  );
});

/**
 * The settings popover's open state, and what it does beyond Radix's own:
 *
 * - Focus moving outside closes it only after a key was pressed while it was
 *   open. bb focuses its composer on its own for about a second after a page
 *   loads, and Radix took that for the user leaving the popover.
 * - It closes once its button is scrolled wholly out of view, where
 *   `following` is true: the popover form follows its button, the phone's
 *   drawer does not.
 * - Closing it returns focus to its button without scrolling the list to it,
 *   unless the user pressed or focused something outside it.
 */
function useSettingsPopover(button: RefObject<HTMLButtonElement | null>, following: boolean) {
  const [open, setOpen] = useState(false);
  const keyPressed = useRef(false);
  const leftOutside = useRef(false);

  useEffect(() => {
    if (!open) return;
    keyPressed.current = false;
    const onKey = () => (keyPressed.current = true);
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    const target = button.current;
    if (!open || !following || target === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) setOpen(false);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, following, button]);

  const contentProps: Pick<ComponentProps<typeof PopoverContent>, "onFocusOutside" | "onInteractOutside" | "onCloseAutoFocus"> = {
    onFocusOutside: (event) => {
      if (!keyPressed.current) event.preventDefault();
    },
    onInteractOutside: (event) => {
      if (!event.defaultPrevented && !button.current?.contains(event.target as Node)) leftOutside.current = true;
    },
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      if (!leftOutside.current) button.current?.focus({ preventScroll: true });
      leftOutside.current = false;
    },
  };
  return { open, onOpenChange: setOpen, contentProps };
}
