// The Project ▸ dialogs: rename, add a local path on a machine, and remove.
import { useState } from "react";
import { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { messageOf } from "@/lib/error-message";
import type { RpcContract } from "@/shared/contract";
import { defaultMachineId, useMachineList } from "@/shared/machines";
import { MACHINES_FAILED, type ProjectDialogKind } from "../model/menu";
import { localPathError, MAX_LOCAL_PATH_LENGTH, MAX_PROJECT_NAME_LENGTH, projectNameError } from "../model/projects";
import { removeProject, RemoveProjectConfirmation } from "./RemoveProject";
import { useDialogContext } from "./use-dialog-context";

export function ProjectDialog({ kind, projectId, onClose }: { kind: ProjectDialogKind; projectId: string; onClose(): void }) {
  const { projects } = useDialogContext();
  const project = projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {kind === "rename" ? <RenameProject projectId={projectId} name={project.name} onClose={onClose} /> : null}
        {kind === "add-path" ? <AddLocalPath projectId={projectId} name={project.name} onClose={onClose} /> : null}
        {kind === "remove" ? <RemoveProjectDialog projectId={projectId} name={project.name} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameProject({ projectId, name, onClose }: { projectId: string; name: string; onClose(): void }) {
  const sdk = useSdk();
  const [value, setValue] = useState(name);
  const error = projectNameError(value);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (error !== null) return;
        onClose();
        try {
          await sdk.projects.update({ projectId, name: value.trim() });
        } catch (failure) {
          toast.error(messageOf(failure, "Failed to rename project."));
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename project</DialogTitle>
        <DialogDescription>{name}</DialogDescription>
      </DialogHeader>
      <label className="grid gap-1 text-sm">
        Project name
        <Input value={value} maxLength={MAX_PROJECT_NAME_LENGTH + 1} onChange={(event) => setValue(event.target.value)} autoFocus />
      </label>
      {value !== name && error !== null ? (
        <p role="alert" className="text-sm text-[color:var(--tg-failed)]">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={error !== null || value.trim() === name}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddLocalPath({ projectId, name, onClose }: { projectId: string; name: string; onClose(): void }) {
  const sdk = useSdk();
  const machines = useMachineList();
  const [picked, setPicked] = useState("");
  const hostId = picked || defaultMachineId(machines);
  const [path, setPath] = useState("");
  const error = localPathError(path);
  const ready = machines.status === "ready" && hostId !== "" && error === null;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready) return;
        onClose();
        try {
          await sdk.projects.sources.add({ projectId, type: "local_path", hostId, path: path.trim() });
          toast.success("Local path added");
        } catch (failure) {
          toast.error(messageOf(failure, "Failed to add local path."));
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Add local path</DialogTitle>
        <DialogDescription>{name}</DialogDescription>
      </DialogHeader>
      {machines.status === "failed" ? (
        <p role="alert" className="text-sm text-[color:var(--tg-failed)]">
          {MACHINES_FAILED}
        </p>
      ) : null}
      <label className="grid gap-1 text-sm">
        Machine
        <select
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
          value={hostId}
          disabled={machines.status !== "ready"}
          onChange={(event) => setPicked(event.target.value)}
        >
          {machines.status === "ready"
            ? machines.machines.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                </option>
              ))
            : null}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Folder
        <Input value={path} maxLength={MAX_LOCAL_PATH_LENGTH + 1} placeholder="/path/to/folder" onChange={(event) => setPath(event.target.value)} />
      </label>
      {path !== "" && error !== null ? (
        <p role="alert" className="text-sm text-[color:var(--tg-failed)]">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Add path
        </Button>
      </DialogFooter>
    </form>
  );
}

function RemoveProjectDialog({ projectId, name, onClose }: { projectId: string; name: string; onClose(): void }) {
  const sdk = useSdk();
  const rpc = useRpc<RpcContract>();
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Remove project</DialogTitle>
        <DialogDescription>{name}</DialogDescription>
      </DialogHeader>
      <RemoveProjectConfirmation
        projectName={name}
        onCancel={onClose}
        onConfirm={async () => {
          if (await removeProject(sdk, rpc, projectId)) onClose();
        }}
      />
    </div>
  );
}
