// Project appearance: whether projects have colours and where their stripes
// show, and, per project, its colour, icon and a preview of its mark.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  pluginData,
  projectColours,
  ProjectMark,
  ProjectName,
  ProjectStripe,
  useAppearance,
  useBbProjectIds,
  useProjectColour,
} from "@/features/thread-list";
import { ICON_TYPES_LABEL } from "@/shared/project-icon";
import type { Settings } from "@/shared/settings";
import type { Appearance, Versioned } from "@/shared/signals";
import { colourError, iconSizeError, iconSourceLine } from "../model/icons";
import { readBase64 } from "../read-file";
import { Group, Row, Select, SelectRow, SwitchRow } from "./Fields";
import type { Form } from "./form";

export const STRIPE_CHOICES: readonly { value: Settings["stripesIn"]; label: string }[] = [
  { value: "full-and-collapsed", label: "Full and collapsed mode" },
  { value: "full", label: "Full mode only" },
  { value: "grouped", label: "Grouped projects only" },
];

/** How long a picked colour waits for the next before it is saved. */
const COLOUR_DELAY_MS = 500;

export function ProjectAppearance({ form, projects }: { form: Form; projects: readonly PluginSidebarProject[] }) {
  const { values, edit } = form;
  return (
    <Group id="tg-project-appearance" title="Project appearance">
      <SwitchRow
        label="Project colors"
        description="Give each project a colour, shown on its name, stripe and monogram."
        checked={values.projectColours === true}
        onChange={(on) => edit("projectColours", on)}
      />
      <SelectRow
        label="Show stripes in"
        description="Where the project's stripe shows."
        value={values.stripesIn as Settings["stripesIn"]}
        choices={STRIPE_CHOICES}
        onChange={(value) => edit("stripesIn", value)}
      />
      <CustomizeProject projects={projects} coloursOn={values.projectColours === true} />
    </Group>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "Something went wrong.";
}

function CustomizeProject({ projects, coloursOn }: { projects: readonly PluginSidebarProject[]; coloursOn: boolean }) {
  const rpc = useRpc<RpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const ids = useBbProjectIds();
  const appearance = useAppearance();
  const [chosen, setChosen] = useState<string | null>(null);
  const project = projects.find((candidate) => candidate.id === chosen) ?? projects[0];
  const projectId = project?.id ?? "";
  const colour = useProjectColour(projectId, ids);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef<{ projectId: string; colour: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const commitColour = () => {
    const waiting = pending.current;
    if (waiting === null) return;
    clearTimeout(waiting.timer);
    pending.current = null;
    rpcRef.current.call("setProjectColour", { projectId: waiting.projectId, colour: waiting.colour }).then(
      (answer) => {
        pluginData.appearanceSignal(answer);
        setDraft((typed) => (typed?.toLowerCase() === waiting.colour ? null : typed));
      },
      (error: unknown) => setProblem(messageOf(error)),
    );
  };
  // A picked colour that is still waiting goes when the page is left.
  useEffect(() => () => commitColour(), []);

  const apply = (action: () => Promise<Versioned<Appearance>>) => {
    setProblem(null);
    action().then(
      (answer) => pluginData.appearanceSignal(answer),
      (error: unknown) => setProblem(messageOf(error)),
    );
  };

  if (project === undefined) {
    return <p className="text-xs text-subtle-foreground">Customize a project: this window has no projects yet.</p>;
  }

  const override = appearance.colours[project.id];
  const automatic = projectColours(ids, appearance.colours).get(project.id) ?? "#808080";
  const shown = draft ?? override ?? automatic;
  const shownError = draft === null ? null : colourError(draft);
  const upload = appearance.icons[project.id];

  const pickColour = (typed: string) => {
    setDraft(typed);
    setProblem(null);
    if (pending.current !== null) clearTimeout(pending.current.timer);
    pending.current = null;
    if (colourError(typed) !== null) return;
    const lowered = typed.trim().toLowerCase();
    const id = project.id;
    pending.current = { projectId: id, colour: lowered, timer: setTimeout(commitColour, COLOUR_DELAY_MS) };
  };

  return (
    <Row label="Customize a project" labelFor="tg-customize-project" description="Pick a colour or upload an icon for one project.">
      <div className="flex w-full min-w-0 flex-col gap-3 sm:w-80">
        <Select
          id="tg-customize-project"
          value={project.id}
          choices={projects.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          onChange={(next) => {
            commitColour();
            setDraft(null);
            setProblem(null);
            setChosen(next);
          }}
        />
        <div
          role="group"
          aria-label="Preview"
          className="relative flex items-center gap-2 overflow-hidden rounded-md border border-border py-2 pl-4 pr-3 text-sm"
        >
          <ProjectStripe colour={colour} />
          <ProjectMark projectId={project.id} name={project.name} colour={colour} />
          <ProjectName name={project.name} colour={colour} />
        </div>
        {coloursOn ? null : <p className="text-xs text-subtle-foreground">Turn on Project colors to see the colour on the project.</p>}
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Project colour picker"
            value={/^#[0-9a-f]{6}$/i.test(shown) ? shown.toLowerCase() : automatic}
            onChange={(event) => pickColour(event.target.value)}
            className="h-9 w-10 cursor-pointer rounded-md border border-input bg-transparent p-1"
          />
          <Input
            aria-label="Project colour"
            aria-invalid={shownError !== null}
            value={shown}
            onChange={(event) => pickColour(event.target.value)}
            className="w-28 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={override === undefined && draft === null}
            onClick={() => {
              if (pending.current !== null) clearTimeout(pending.current.timer);
              pending.current = null;
              setDraft(null);
              if (override !== undefined) apply(() => rpcRef.current.call("resetProjectColour", { projectId: project.id }));
            }}
          >
            Reset
          </Button>
        </div>
        {shownError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {shownError}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Input
            type="file"
            aria-label="Upload icon"
            accept="image/svg+xml,image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/gif,image/avif,image/webp,.svg,.png,.ico,.jpg,.jpeg,.gif,.avif,.webp"
            className="text-xs"
            onChange={(event) => {
              const input = event.target;
              const file = input.files?.[0];
              input.value = "";
              if (file === undefined) return;
              const refusal = iconSizeError(file.size);
              if (refusal !== null) {
                setProblem(refusal);
                return;
              }
              apply(async () =>
                rpcRef.current.call("uploadProjectIcon", {
                  projectId: project.id,
                  name: file.name,
                  mime: file.type,
                  dataBase64: await readBase64(file),
                }),
              );
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={upload === undefined}
            onClick={() => apply(() => rpcRef.current.call("clearProjectIcon", { projectId: project.id }))}
          >
            Use automatic
          </Button>
        </div>
        <p className="text-xs text-subtle-foreground">{iconSourceLine(upload)}</p>
        <p className="text-xs text-subtle-foreground">{ICON_TYPES_LABEL}, up to 1 MB.</p>
        {problem !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        ) : null}
      </div>
    </Row>
  );
}
