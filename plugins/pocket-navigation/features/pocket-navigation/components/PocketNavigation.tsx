import type { ComponentProps } from "react";
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_useSidebarNavigation,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { pocketLayout } from "../model/layout";

type Item = ExperimentalSidebarNavigationItem;

// The height, colours and states of bb's own navigation rows.
const CONTROL = cn(
  "h-[var(--bb-sidebar-row-height)] max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse)]",
  "shrink-0 cursor-pointer rounded-md font-normal text-sidebar-foreground transition-none",
  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 ring-sidebar-ring",
  "disabled:cursor-default disabled:opacity-70 max-md:pointer-coarse:[&_[data-icon-root]]:size-5",
);
const ICON_BUTTON = cn(CONTROL, "aspect-square px-0");
const ACTIVE = "bg-sidebar-accent text-sidebar-foreground";

/**
 * bb's sidebar navigation, drawn on a phone as one icon row and a New thread
 * line, and everywhere else as bb draws it.
 */
export function PocketNavigation({ isCompactViewport, experimental_Original: Original }: ExperimentalSidebarNavigationProps) {
  if (!isCompactViewport) return <Original />;
  return (
    <CompactViewportOverrideProvider isCompactViewport>
      <PhoneNavigation />
    </CompactViewportOverrideProvider>
  );
}

function PhoneNavigation() {
  const { items, activeItemId, actions } = experimental_useSidebarNavigation();
  if (items.length === 0) return null;
  const { iconRow, newThread, search, overflow } = pocketLayout(items);
  const isActive = (item: Item) => item.id === activeItemId;
  const activate = (item: Item) => actions.activate(item.id, { openInSplit: false });
  const itemProps = (item: Item) => ({
    disabled: item.isDisabled,
    "aria-busy": item.isLoading || undefined,
    "aria-current": isActive(item) ? ("page" as const) : undefined,
    onClick: () => activate(item),
  });

  return (
    <TooltipProvider>
      <nav aria-label="Sidebar navigation" className="shrink-0 space-y-0.5 px-2 py-2">
        <div className="flex items-center gap-0.5">
          {/* Scrolls sideways when the icons outgrow the sidebar; "…" stays put. */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {iconRow.map((item) => (
              <IconButton key={item.id} item={item} isActive={isActive(item)} {...itemProps(item)} />
            ))}
          </div>
          {overflow.length > 0 ? (
            <Overflow items={overflow} isActive={isActive} onActivate={activate} onCustomize={actions.openCustomize} />
          ) : null}
        </div>
        {newThread !== null || search !== null ? (
          <div className="flex items-center gap-0.5">
            {newThread !== null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(CONTROL, "min-w-0 flex-1 justify-start gap-2 pl-2 text-sm", isActive(newThread) && ACTIVE)}
                {...itemProps(newThread)}
              >
                <NavigationIcon icon={newThread.icon} />
                <span className="min-w-0 truncate">{newThread.label}</span>
              </Button>
            ) : null}
            {search !== null ? (
              <IconButton item={search} isActive={isActive(search)} className="ml-auto" {...itemProps(search)} />
            ) : null}
          </div>
        ) : null}
      </nav>
      <div aria-hidden="true" className="mx-2 my-2 shrink-0 border-t border-sidebar-border/25" />
    </TooltipProvider>
  );
}

interface IconButtonProps extends ComponentProps<typeof Button> {
  item: Item;
  isActive: boolean;
}

function IconButton({ item, isActive, className, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={item.label}
          className={cn(ICON_BUTTON, isActive && ACTIVE, className)}
          {...props}
        >
          <NavigationIcon icon={item.icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{item.label}</TooltipContent>
    </Tooltip>
  );
}

interface OverflowProps {
  items: readonly Item[];
  isActive(item: Item): boolean;
  onActivate(item: Item): void;
  onCustomize(): void;
}

/** "…": every hidden item, then bb's Customize sidebar, as bb's own More lists them. */
function Overflow({ items, isActive, onActivate, onCustomize }: OverflowProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More sidebar navigation"
              className={ICON_BUTTON}
            >
              <Icon name="MoreHorizontal" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" mobileTitle="More" aria-label="More sidebar navigation" className="w-56">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.isDisabled}
            className={cn(isActive(item) && ACTIVE)}
            onSelect={() => onActivate(item)}
          >
            <NavigationIcon icon={item.icon} />
            {/* The phone drawer's item drops attributes it does not know, so the mark sits inside it. */}
            <span aria-current={isActive(item) ? "page" : undefined}>{item.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCustomize}>
          <Icon name="FilterHorizontal" aria-hidden="true" />
          Customize sidebar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
