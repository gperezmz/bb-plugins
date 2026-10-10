// The row menu as a right-click context menu or a "…" dropdown, which
// becomes a bottom drawer on compact viewports.
import { Fragment } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
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
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import type { MenuChoice, RowMenuItem } from "../model/menu";

interface MenuProps {
  items: readonly RowMenuItem[];
  /** `value` is the picked choice's id, for an item with choices. */
  onSelect(item: RowMenuItem, value?: string): void;
  /** Rename keeps focus in its editor instead of returning it to the row. */
  onCloseAutoFocus(event: Event): void;
}

function ItemLabel({ item }: { item: Pick<RowMenuItem, "icon" | "label" | "detail"> }) {
  return (
    <>
      <Icon name={item.icon} aria-hidden className="size-4" />
      {item.detail === undefined ? (
        <span>{item.label}</span>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span>{item.label}</span>
          <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
        </span>
      )}
    </>
  );
}

/** A pick in a choice list: its icon, or a check on the selected one and room for one on the rest. */
function ChoiceLabel({ choice }: { choice: MenuChoice }) {
  return (
    <>
      {choice.icon !== undefined ? (
        <Icon name={choice.icon} aria-hidden className="size-4" />
      ) : choice.selected ? (
        <Icon name={ICONS.check} aria-hidden className="size-4" />
      ) : (
        <span className="size-4" />
      )}
      {choice.label}
    </>
  );
}

function ChoiceHint({ hint }: { hint: string | undefined }) {
  return hint === undefined ? null : <p className="px-2 py-1.5 text-xs text-muted-foreground">{hint}</p>;
}

const itemClass = (item: RowMenuItem) => cn(item.destructive && "text-destructive focus:text-destructive");

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
  onSelect,
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
        <Fragment key={item.key}>
          {item.separated ? <ContextMenuSeparator /> : null}
          {item.choices !== undefined ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={item.disabled}>
                <ItemLabel item={item} />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {item.choices.items.map((choice) => (
                  <ContextMenuItem key={choice.id} disabled={choice.disabled} onSelect={guard(() => onSelect(item, choice.id))}>
                    <ChoiceLabel choice={choice} />
                  </ContextMenuItem>
                ))}
                <ChoiceHint hint={item.choices.hint} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : (
            <ContextMenuItem className={itemClass(item)} disabled={item.disabled} onSelect={guard(() => onSelect(item))}>
              <ItemLabel item={item} />
            </ContextMenuItem>
          )}
        </Fragment>
      ))}
    </ContextMenuContent>
  );
}

export function RowDropdownMenuContent({ items, onSelect, onCloseAutoFocus }: MenuProps) {
  // A phone's drawer holds no submenu: the choices follow their heading.
  const drawer = useIsCompactViewport();
  return (
    <DropdownMenuContent align="end" className="min-w-48" onCloseAutoFocus={onCloseAutoFocus}>
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.separated ? <DropdownMenuSeparator /> : null}
          {item.choices !== undefined && drawer ? (
            <div role="group" aria-label={item.choices.heading ?? item.label}>
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <ItemLabel item={{ ...item, label: item.choices.heading ?? item.label }} />
              </div>
              {item.choices.items.map((choice) => (
                <DropdownMenuItem
                  key={choice.id}
                  disabled={item.disabled || choice.disabled}
                  className="pl-8"
                  onSelect={() => onSelect(item, choice.id)}
                >
                  <ChoiceLabel choice={choice} />
                </DropdownMenuItem>
              ))}
              <ChoiceHint hint={item.choices.hint} />
            </div>
          ) : item.choices !== undefined ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={item.disabled}>
                <ItemLabel item={item} />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {item.choices.items.map((choice) => (
                  <DropdownMenuItem key={choice.id} disabled={choice.disabled} onSelect={() => onSelect(item, choice.id)}>
                    <ChoiceLabel choice={choice} />
                  </DropdownMenuItem>
                ))}
                <ChoiceHint hint={item.choices.hint} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem className={itemClass(item)} disabled={item.disabled} onSelect={() => onSelect(item)}>
              <ItemLabel item={item} />
            </DropdownMenuItem>
          )}
        </Fragment>
      ))}
    </DropdownMenuContent>
  );
}
