// "Parent": a search dialog that makes another thread the chosen thread's
// parent, or none. The change goes to bb's API from the browser, as bb's own
// list does.
import { useEffect, useMemo, useState } from "react";
import { experimental_Icon as Icon, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parentOptions, unpinsOnChoice, type ParentOption, type ParentThread } from "../model/parents";
import { useDialogContext } from "./use-dialog-context";

export const PARENT_UPDATED = "Parent updated";
export const PARENT_REMOVED = "Parent removed";
export const UNPIN_UNCONFIRMED = "Parent updated, but unpinning could not be confirmed";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ParentDialog({ threadId, onClose }: { threadId: string; onClose(): void }) {
  const sdk = useSdk();
  const { threads, projects } = useDialogContext();
  const thread = threads.find((candidate) => candidate.id === threadId);
  const parentId = thread?.parentThreadId ?? null;
  const parentListed = parentId !== null && threads.some((candidate) => candidate.id === parentId);

  // An archived parent is not among the threads bb lists; it is read so the dialog can still show it checked.
  const [archivedParent, setArchivedParent] = useState<ParentThread | null>(null);
  useEffect(() => {
    if (parentId === null || parentListed) return;
    let current = true;
    Promise.resolve()
      .then(() => sdk.threads.get({ threadId: parentId }))
      .then(
        (found) => {
          if (!current || "thread" in found) return;
          setArchivedParent({
            id: found.id,
            displayTitle: found.title ?? found.titleFallback ?? found.id,
            projectId: found.projectId,
            parentThreadId: found.parentThreadId,
            isArchived: found.archivedAt !== null,
            isHidden: false,
            createdAt: found.createdAt,
            updatedAt: found.updatedAt,
            latestAttentionAt: found.latestAttentionAt,
          });
        },
        () => {},
      );
    return () => {
      current = false;
    };
  }, [sdk, parentId, parentListed]);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const options = useMemo(
    () => (thread === undefined ? [] : parentOptions({ thread, threads, currentParent: archivedParent, projectNames, query })),
    [thread, threads, archivedParent, projectNames, query],
  );
  const activeIndex = Math.min(active, options.length - 1);

  const choose = async (option: ParentOption) => {
    onClose();
    if (thread === undefined || option.id === parentId) return;
    try {
      await sdk.threads.update({ threadId, parentThreadId: option.id });
    } catch (error) {
      toast.error(messageOf(error));
      return;
    }
    if (!unpinsOnChoice(thread.isPinned, option.id)) {
      toast.success(option.id === null ? PARENT_REMOVED : PARENT_UPDATED);
      return;
    }
    try {
      await sdk.threads.unpin({ threadId });
      toast.success(PARENT_UPDATED);
    } catch {
      toast.error(UNPIN_UNCONFIRMED);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) void choose(option);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Parent</DialogTitle>
          <DialogDescription className="truncate">{thread?.displayTitle ?? "This thread"}</DialogDescription>
        </DialogHeader>
        <Input
          role="combobox"
          aria-label="Search threads"
          aria-expanded
          aria-controls="tg-parent-options"
          aria-activedescendant={options.length > 0 ? `tg-parent-option-${activeIndex}` : undefined}
          placeholder="Search threads"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <ul id="tg-parent-options" role="listbox" aria-label="Parent" className="max-h-72 overflow-y-auto">
          {options.map((option, index) => (
            <li
              key={option.id ?? "none"}
              id={`tg-parent-option-${index}`}
              role="option"
              aria-selected={option.checked}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                index === activeIndex ? "bg-state-hover" : "",
                option.id === null ? "text-muted-foreground" : "",
              )}
              onMouseMove={() => setActive(index)}
              onClick={() => void choose(option)}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.checked ? <Icon name="Check" className="size-4 shrink-0" /> : null}
            </li>
          ))}
        </ul>
        {thread?.isPinned ? <p className="text-xs text-muted-foreground">Choosing a parent unpins this thread. None keeps it pinned.</p> : null}
      </DialogContent>
    </Dialog>
  );
}
