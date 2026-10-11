// The project scope picker: "All projects" or one project, filtering every
// shelf. It is not saved: each mount of the list starts on All projects.
import { useId, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { filterScopeOptions, moveHighlight, scopeLabel, scopeOptions } from "../model/scope";
import { useCommands, useScope } from "../store/hooks";

export function ProjectScope() {
  const { scopeId, projects } = useScope();
  const commands = useCommands();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();
  const options = filterScopeOptions(scopeOptions(projects), query);

  const choose = (id: string | null) => {
    commands.setScope(id);
    setOpen(false);
  };
  const reset = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setHighlight(Math.max(0, scopeOptions(projects).findIndex((option) => option.id === scopeId)));
    }
  };

  return (
    <div className="px-1.5 pb-1">
      <Popover open={open} onOpenChange={reset}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-label={`Project scope: ${scopeLabel(scopeId, projects)}`}
            className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm text-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Icon name="Folder" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{scopeLabel(scopeId, projects)}</span>
            <Icon name="ChevronDown" aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <input
            role="combobox"
            aria-label="Filter projects"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={highlight >= 0 && options[highlight] !== undefined ? `${listId}-${highlight}` : undefined}
            placeholder="Filter projects"
            value={query}
            autoFocus
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                event.preventDefault();
                setHighlight(moveHighlight(highlight, event.key, options.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const option = options[highlight];
                if (option !== undefined) choose(option.id);
              }
            }}
            className="mb-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div id={listId} role="listbox" aria-label="Projects" className="max-h-64 overflow-y-auto">
            {options.map((option, index) => (
              <div
                key={option.id ?? "all"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.id === scopeId}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option.id)}
                className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm", index === highlight && "bg-sidebar-accent")}
              >
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.id === scopeId ? <Icon name="Check" aria-hidden className="size-3.5 shrink-0" /> : null}
              </div>
            ))}
            {options.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">No projects match.</p> : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
