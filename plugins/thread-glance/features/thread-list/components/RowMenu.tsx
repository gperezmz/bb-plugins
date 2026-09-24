// The row menu as a right-click context menu or a "…" dropdown, which
// becomes a bottom drawer on compact viewports.
import { Fragment } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarSection } from "@get-bb/plugin-sdk/app";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import type { RowMenuAction, RowMenuItem } from "../model/menu";

interface MenuProps {
  items: readonly RowMenuItem[];
  sections: readonly PluginSidebarSection[];
  currentSectionId: string | null;
  onAction(action: RowMenuAction, sectionId?: string | null): void;
  /** Rename keeps focus in its editor instead of returning it to the row. */
  onCloseAutoFocus(event: Event): void;
}

function ItemLabel({ item }: { item: Pick<RowMenuItem, "icon" | "label"> }) {
  return (
    <>
      <Icon name={item.icon} aria-hidden className="size-4" />
      <span>{item.label}</span>
    </>
  );
}

function sectionTargets(sections: readonly PluginSidebarSection[]) {
  return [{ id: null as string | null, name: "Threads" }, ...sections.map((s) => ({ id: s.id as string | null, name: s.name }))];
}

/**
 * What the user has done inside an open context menu. The right-click that
 * opens it is released over whatever item opened under the pointer (the
 * menu opens upward near the bottom of the list), and that release selects
 * the item. A real choice is preceded by a new press or a key in the menu;
 * the row resets this when the menu opens.
 */
export interface ContextMenuInput {
  pressed: boolean;
  keyed: boolean;
}

export function RowContextMenuContent({
  items,
  sections,
  currentSectionId,
  onAction,
  onCloseAutoFocus,
  input,
}: MenuProps & {
  input: { readonly current: ContextMenuInput };
}) {
  const guard = (run: () => void) => (event: Event) => {
    if (!input.current.pressed && !input.current.keyed) {
      event.preventDefault();
      return;
    }
    run();
  };
  return (
    <ContextMenuContent
      className="min-w-48"
      onCloseAutoFocus={onCloseAutoFocus}
      onPointerDown={() => {
        input.current.pressed = true;
      }}
      onKeyDown={() => {
        input.current.keyed = true;
      }}
    >
      {items.map((item) => (
        <Fragment key={item.action}>
          {item.separated ? <ContextMenuSeparator /> : null}
          {item.action === "move-to-section" ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <ItemLabel item={item} />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {sectionTargets(sections).map((target) => (
                  <ContextMenuItem
                    key={target.id ?? "threads"}
                    disabled={target.id === currentSectionId}
                    onSelect={guard(() => onAction("move-to-section", target.id))}
                  >
                    {target.id === currentSectionId ? (
                      <Icon name={ICONS.check} aria-hidden className="size-4" />
                    ) : (
                      <span className="size-4" />
                    )}
                    {target.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : (
            <ContextMenuItem
              className={cn(item.destructive && "text-destructive focus:text-destructive")}
              onSelect={guard(() => onAction(item.action))}
            >
              <ItemLabel item={item} />
            </ContextMenuItem>
          )}
        </Fragment>
      ))}
    </ContextMenuContent>
  );

}

export function RowDropdownMenuContent({ items, sections, currentSectionId, onAction, onCloseAutoFocus }: MenuProps) {
  return (
    <DropdownMenuContent align="end" className="min-w-48" onCloseAutoFocus={onCloseAutoFocus}>
      {items.map((item) => (
        <Fragment key={item.action}>
          {item.separated ? <DropdownMenuSeparator /> : null}
          {item.action === "move-to-section" ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ItemLabel item={item} />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {sectionTargets(sections).map((target) => (
                  <DropdownMenuItem
                    key={target.id ?? "threads"}
                    disabled={target.id === currentSectionId}
                    onSelect={() => onAction("move-to-section", target.id)}
                  >
                    {target.id === currentSectionId ? (
                      <Icon name={ICONS.check} aria-hidden className="size-4" />
                    ) : (
                      <span className="size-4" />
                    )}
                    {target.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem
              className={cn(item.destructive && "text-destructive focus:text-destructive")}
              onSelect={() => onAction(item.action)}
            >
              <ItemLabel item={item} />
            </DropdownMenuItem>
          )}
        </Fragment>
      ))}
    </DropdownMenuContent>
  );
}
