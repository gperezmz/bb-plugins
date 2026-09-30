import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";
import {
  type ResponsiveOverlayContextValue,
  COMPACT_SHEET_CONTENT_STYLE,
  useResponsiveRoot,
  MobileTrigger,
  ResponsiveDrawerShell,
  stripRadixContentProps,
} from "./responsive-overlay.js";
import {
  blurActiveKeyboardInputBeforeOverlayOpen,
  getOverlayTriggerClassName,
  isLastInputKeyboard,
  preventOverlayTriggerSelection,
} from "./overlay-trigger.js";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  MenuHoverProvider,
  useMenuItemHover,
} from "./menu-item-hover.js";
import { LIST_HOVER_TRANSITION } from "./motion.js";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

const MENU_ITEM_NEUTRAL_STATE_CLASS =
  "focus:bg-state-hover focus:text-foreground data-[last-hovered]:bg-state-hover data-[last-hovered]:text-foreground";

const ResponsiveMenuContext =
  React.createContext<ResponsiveOverlayContextValue>({
    isCompactViewport: false,
    open: false,
    onOpenChange: () => {},
  });

function useResponsiveMenu() {
  return React.useContext(ResponsiveMenuContext);
}

function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnChange,
  defaultOpen,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const ctx = useResponsiveRoot(
    controlledOpen,
    controlledOnChange,
    defaultOpen,
  );

  if (ctx.isCompactViewport) {
    return (
      <ResponsiveMenuContext.Provider value={ctx}>
        {children}
      </ResponsiveMenuContext.Provider>
    );
  }

  return (
    <DropdownMenuPrimitive.Root
      open={ctx.open}
      onOpenChange={ctx.onOpenChange}
      {...props}
    >
      <ResponsiveMenuContext.Provider value={ctx}>
        {children}
      </ResponsiveMenuContext.Provider>
    </DropdownMenuPrimitive.Root>
  );
}

const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ asChild, children, className, ...props }, ref) => {
  const { isCompactViewport, open, onOpenChange } = useResponsiveMenu();

  if (isCompactViewport) {
    return (
      <MobileTrigger
        ref={ref}
        asChild={asChild}
        open={open}
        onOpenChange={onOpenChange}
        haspopup="menu"
        className={className}
        {...props}
      >
        {children}
      </MobileTrigger>
    );
  }

  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      asChild={asChild}
      className={getOverlayTriggerClassName(className)}
      onMouseDown={(event) => {
        if (!open) {
          blurActiveKeyboardInputBeforeOverlayOpen();
        }
        preventOverlayTriggerSelection(event);
      }}
      {...props}
    >
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
});
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(
  (
    {
      className,
      sideOffset = 4,
      children,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const { isCompactViewport, open, onOpenChange } = useResponsiveMenu();
    const scopeProps = usePortalScopeProps();

    if (isCompactViewport) {
      const { style, ...domProps } = stripRadixContentProps(props);
      return (
        <ResponsiveDrawerShell
          open={open}
          onOpenChange={onOpenChange}
          srLabel="Menu"
        >
          <div
            ref={ref}
            className={cn(
              "flex flex-col gap-0.5 overflow-y-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
              className,
            )}
            {...domProps}
            style={{ ...style, ...COMPACT_SHEET_CONTENT_STYLE }}
          >
            {children}
          </div>
        </ResponsiveDrawerShell>
      );
    }

    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={ref}
          {...scopeProps}
          sideOffset={sideOffset}
          onCloseAutoFocus={(event) => {
            if (!isLastInputKeyboard()) {
              event.preventDefault();
            }
            onCloseAutoFocus?.(event);
          }}
          className={cn(
            "z-50 min-w-28 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        >
          <MenuHoverProvider>{children}</MenuHoverProvider>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    );
  },
);
DropdownMenuContent.displayName = "DropdownMenuContent";

function createSelectEvent(): Event {
  return new Event("select", { cancelable: true });
}

type DropdownMenuItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>,
  "onBlur" | "onFocus"
> & {
  onBlur?: React.FocusEventHandler<HTMLElement>;
  onFocus?: React.FocusEventHandler<HTMLElement>;
};

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(
  (
    {
      className,
      onSelect,
      disabled,
      role = "menuitem",
      "aria-checked": ariaChecked,
      textValue: _textValue,
      children,
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      onFocus: callerFocus,
      onBlur: callerBlur,
      ...domProps
    },
    ref,
  ) => {
    const { isCompactViewport, onOpenChange } = useResponsiveMenu();
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    if (isCompactViewport) {
      return (
        <button
          ref={ref as React.RefCallback<HTMLButtonElement> | null}
          type="button"
          role={role}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-checked={ariaChecked}
          className={cn(
            "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-left text-xs outline-none transition-colors focus:bg-state-hover focus:text-foreground active:bg-state-active active:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>[data-icon-root]]:size-4 [&>[data-icon-root]]:shrink-0",
            className,
          )}
          data-disabled={disabled ? "" : undefined}
          onFocus={callerFocus}
          onBlur={callerBlur}
          onClick={() => {
            if (disabled) return;
            const event = createSelectEvent();
            onSelect?.(event);
            if (!event.defaultPrevented) {
              onOpenChange(false);
            }
          }}
        >
          {children}
        </button>
      );
    }

    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>[data-icon-root]]:size-4 [&>[data-icon-root]]:shrink-0",
          LIST_HOVER_TRANSITION,
          MENU_ITEM_NEUTRAL_STATE_CLASS,
          className,
        )}
        disabled={disabled}
        role={role}
        aria-checked={ariaChecked}
        onSelect={onSelect}
        textValue={_textValue}
        onFocus={callerFocus}
        onBlur={callerBlur}
        {...domProps}
        {...hoverProps}
      >
        {children}
      </DropdownMenuPrimitive.Item>
    );
  },
);
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuSeparator = React.forwardRef<
  HTMLHRElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => {
  const { isCompactViewport } = useResponsiveMenu();

  if (isCompactViewport) {
    return (
      <hr
        ref={ref as React.RefCallback<HTMLHRElement> | null}
        className={cn("-mx-1 my-1 h-px border-0 bg-muted", className)}
      />
    );
  }

  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  );
});
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(
  (
    {
      className,
      children,
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
      ...props
    },
    ref,
  ) => {
    const { hoverProps } = useMenuItemHover({
      onPointerEnter: callerPointerEnter,
      onKeyDown: callerKeyDown,
    });

    return (
      <DropdownMenuPrimitive.SubTrigger
        ref={ref}
        className={cn(
          "flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-[0.3125rem] text-xs outline-none focus:bg-state-hover focus:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground [&_[data-icon-root]]:pointer-events-none [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0",
          LIST_HOVER_TRANSITION,
          MENU_ITEM_LAST_HOVERED_CLASS,
          className,
        )}
        {...props}
        {...hoverProps}
      >
        {children}
        <Icon name="ChevronRight" className="ml-auto" />
      </DropdownMenuPrimitive.SubTrigger>
    );
  },
);
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    {...usePortalScopeProps()}
    className={cn(
      "z-50 min-w-28 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
};
