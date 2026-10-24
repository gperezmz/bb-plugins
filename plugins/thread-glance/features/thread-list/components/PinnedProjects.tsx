// The pinned projects as icons above the list: a click puts a project in the
// scope or takes it out, in step with the picker, and Reset clears the scope
// and leaves the pins. The row is there while a project is pinned or the
// scope limits the list.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { ALL_PROJECTS_SCOPE, pinButtonLabel, toggleProject, type PinnedProject } from "../model/scope";
import { ProjectMark } from "../project/ProjectMark";
import { useProjectColour } from "../project/use-project-colour";
import { useProjectIds } from "../project/use-project-ids";
import { useCommands, usePinnedProjects, useScope } from "../store/hooks";
import { Tip } from "./rows/Tip";

const BUTTON =
  "relative flex size-7 shrink-0 items-center justify-center rounded-md outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function PinnedProject({ pin, selected, needsYou }: { pin: PinnedProject; selected: boolean; needsYou: boolean }) {
  const commands = useCommands();
  const { scope } = useScope();
  const colour = useProjectColour(pin.id, useProjectIds());
  return (
    <Tip label={pin.name}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={pinButtonLabel(pin.name, needsYou)}
        onClick={() => commands.setScope(toggleProject(scope, pin.id))}
        className={cn(BUTTON, selected && "bg-sidebar-accent")}
      >
        <ProjectMark projectId={pin.id} name={pin.name} colour={colour} className="size-4" />
        {needsYou ? <Icon name="CircleQuestion" aria-hidden className="absolute -right-0.5 -top-0.5 size-3 text-[color:var(--tg-needs-you)]" /> : null}
      </button>
    </Tip>
  );
}

export function PinnedProjects() {
  const { scope, needingYou } = useScope();
  const pins = usePinnedProjects();
  const commands = useCommands();
  if (pins.length === 0 && scope.length === 0) return null;
  return (
    <div role="group" aria-label="Pinned projects" className="flex flex-wrap items-center gap-1 px-1.5 pb-1">
      {pins.map((pin) => (
        <PinnedProject key={pin.id} pin={pin} selected={scope.includes(pin.id)} needsYou={needingYou.includes(pin.id)} />
      ))}
      {scope.length > 0 ? (
        <Tip label="Reset">
          <button type="button" aria-label="Reset" onClick={() => commands.setScope(ALL_PROJECTS_SCOPE)} className={cn(BUTTON, "ml-auto text-muted-foreground hover:text-foreground")}>
            <Icon name="X" aria-hidden className="size-3.5" />
          </button>
        </Tip>
      ) : null}
    </div>
  );
}
