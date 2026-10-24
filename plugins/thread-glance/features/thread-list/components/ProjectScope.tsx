// The project scope picker: All projects, or the projects ticked in it,
// filtering every shelf. A tick applies at once and Done closes the picker.
// The window keeps the scope across reloads; a project left out that has a
// thread waiting on the person marks the button and its own row.
import { useId, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ALL_PROJECTS_SCOPE, filterScopeOptions, firstSelectedIndex, isOptionSelected, moveHighlight, scopeButtonLabel, scopeLabel, scopeOptions, toggleProject, type ScopeOption } from "../model/scope";
import { useCommands, useScope } from "../store/hooks";

function NeedsYouMark() {
  return (
    <span role="img" aria-label="Needs you" className="shrink-0 text-[color:var(--tg-needs-you)]">
      <Icon name="CircleQuestion" aria-hidden className="size-3.5" />
    </span>
  );
}

export function ProjectScope() {
  const { scope, projects, needingYou } = useScope();
  const commands = useCommands();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();
  const options = filterScopeOptions(scopeOptions(projects), query);

  const choose = (option: ScopeOption) => {
    commands.setScope(option.id === null ? ALL_PROJECTS_SCOPE : toggleProject(scope, option.id));
  };
  const reset = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setHighlight(firstSelectedIndex(scope, scopeOptions(projects)));
    }
  };

  return (
    <div className="px-1.5 pb-1">
      <Popover open={open} onOpenChange={reset}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-label={scopeButtonLabel(scope, projects, needingYou)}
            className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm text-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Icon name="Folder" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{scopeLabel(scope, projects)}</span>
            {needingYou.length > 0 ? <Icon name="CircleQuestion" aria-hidden className="size-3.5 shrink-0 text-[color:var(--tg-needs-you)]" /> : null}
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
                if (option !== undefined) choose(option);
              }
            }}
            className="mb-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div id={listId} role="listbox" aria-label="Projects" aria-multiselectable className="max-h-64 overflow-y-auto">
            {options.map((option, index) => (
              <div
                key={option.id ?? "all"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isOptionSelected(scope, option)}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option)}
                className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm", index === highlight && "bg-sidebar-accent")}
              >
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.id !== null && needingYou.includes(option.id) ? <NeedsYouMark /> : null}
                {isOptionSelected(scope, option) ? <Icon name="Check" aria-hidden className="size-3.5 shrink-0" /> : null}
              </div>
            ))}
            {options.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">No projects match.</p> : null}
          </div>
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => reset(false)}
              className="h-8 rounded-md px-3 text-sm font-medium outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              Done
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
