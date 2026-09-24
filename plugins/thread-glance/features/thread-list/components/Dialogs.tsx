// Dialogs the list opens: customize, new section, confirmations and the
// compact details drawer. Dialogs become drawers on compact.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";

export interface CustomizeItem {
  id: string;
  label: string;
  hidden: boolean;
  /** Pinned can't be hidden. */
  hideable: boolean;
}

/** "Customize list": eye toggles and reorder. */
export function CustomizeDialog({
  open,
  items,
  onOpenChange,
  onToggleHidden,
  onMove,
}: {
  open: boolean;
  items: readonly CustomizeItem[];
  onOpenChange(open: boolean): void;
  onToggleHidden(id: string): void;
  onMove(id: string, direction: -1 | 1): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Customize list</DialogTitle>
          <DialogDescription>Hidden groups move into More. Their counters still show there.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-0.5" aria-label="Groups">
          {items.map((item, index) => (
            <li
              key={item.id}
              data-sidebar-customize-item={item.id}
              className="flex items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-sm hover:bg-accent"
            >
              <span className={cn("min-w-0 flex-1 truncate", item.hidden && "text-muted-foreground")}>{item.label}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Move ${item.label} up`}
                disabled={index === 0}
                onClick={() => onMove(item.id, -1)}
              >
                <Icon name={ICONS.moveUp} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Move ${item.label} down`}
                disabled={index === items.length - 1}
                onClick={() => onMove(item.id, 1)}
              >
                <Icon name={ICONS.collapse} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-pressed={!item.hidden}
                aria-label={item.hidden ? `Show ${item.label}` : `Hide ${item.label}`}
                disabled={!item.hideable}
                onClick={() => onToggleHidden(item.id)}
              >
                <Icon name={item.hidden ? ICONS.hidden : ICONS.show} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewSectionDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(name: string): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed === "") return;
            setBusy(true);
            try {
              await onCreate(trimmed);
              onOpenChange(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>New section</DialogTitle>
          </DialogHeader>
          <Input autoFocus aria-label="Section name" value={name} onChange={(event) => setName(event.target.value)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DetailsDialog({
  open,
  title,
  onOpenChange,
  children,
}: {
  open: boolean;
  title: string;
  onOpenChange(open: boolean): void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="sr-only">{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Move…": nest a thread under another, or move it to the top
 * level, from the keyboard. Arrow keys pick, Enter moves.
 */
export function MoveDialog({
  open,
  title,
  targets,
  query,
  onQueryChange,
  onOpenChange,
  onMove,
}: {
  open: boolean;
  title: string;
  targets: readonly { parentThreadId: string | null; label: string; detail: string | null }[];
  query: string;
  onQueryChange(query: string): void;
  onOpenChange(open: boolean): void;
  onMove(parentThreadId: string | null): void;
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [query, open]);
  const choose = (target: (typeof targets)[number] | undefined) => {
    if (target === undefined) return;
    onMove(target.parentThreadId);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Move “{title}”</DialogTitle>
          <DialogDescription>Nest it under another thread, or move it to the top level.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="thread-glance-move-targets"
          aria-activedescendant={targets[index] ? `thread-glance-move-${index}` : undefined}
          aria-label="Find a thread"
          placeholder="Find a thread"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((value) => Math.min(value + 1, targets.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(targets[index]);
            }
          }}
        />
        <ul id="thread-glance-move-targets" role="listbox" aria-label="Move to" className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {targets.length === 0 ? <li className="px-2 py-1.5 text-sm text-muted-foreground">No matching threads</li> : null}
          {targets.map((target, position) => (
            <li
              key={target.parentThreadId ?? "top"}
              id={`thread-glance-move-${position}`}
              role="option"
              aria-selected={position === index}
              onMouseEnter={() => setIndex(position)}
              onClick={() => choose(target)}
              className={cn(
                "flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm",
                position === index && "bg-accent",
              )}
            >
              <span className="truncate">{target.label}</span>
              {target.detail ? <span className="truncate text-xs text-muted-foreground">{target.detail}</span> : null}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
