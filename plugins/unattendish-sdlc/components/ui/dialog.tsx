import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";

const Dialog = DialogPrimitive.Root;

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const DialogClose = DialogPrimitive.Close;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  // Portalled to the body so no card, hover card or header row around the opener holds it; scope props keep plugin styles.
  const scopeProps = usePortalScopeProps();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay {...scopeProps} className="fixed inset-0 z-50 bg-surface-scrim" />
      <DialogPrimitive.Content
        ref={ref}
        {...scopeProps}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border bg-popover p-5 text-sm text-popover-foreground shadow-lg outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle };
