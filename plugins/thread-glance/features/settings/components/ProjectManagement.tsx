// Project management: remove a project, with its name typed.
import { useState } from "react";
import { useRpc, useSdk, type PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { removeProject, RemoveProjectConfirmation } from "@/features/thread-actions";
import type { RpcContract } from "@/shared/contract";
import { Group, Row, Select } from "./Fields";

export function ProjectManagement({ projects }: { projects: readonly PluginSidebarProject[] }) {
  const sdk = useSdk();
  const rpc = useRpc<RpcContract>();
  const [chosen, setChosen] = useState<string | null>(null);
  const removable = projects.filter((project) => !project.isPersonal);
  const project = removable.find((candidate) => candidate.id === chosen) ?? removable[0];
  return (
    <Group id="tg-project-management" title="Project management">
      {project === undefined ? (
        <p className="text-xs text-subtle-foreground">There is no project to remove.</p>
      ) : (
        <Row label="Remove a project" labelFor="tg-remove-project" description="Choose the project, then type its name to confirm.">
          <div className="flex w-full min-w-0 flex-col gap-3 sm:w-80">
            <Select
              id="tg-remove-project"
              value={project.id}
              choices={removable.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              onChange={setChosen}
            />
            {/* Keyed by project so a typed name never carries over to another project. */}
            <RemoveProjectConfirmation key={project.id} projectName={project.name} onConfirm={() => void removeProject(sdk, rpc, project.id)} />
          </div>
        </Row>
      )}
    </Group>
  );
}
