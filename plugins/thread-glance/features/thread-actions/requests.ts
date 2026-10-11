// Requests from the thread menu to the dialogs the app mounts once. The menu
// is evaluated by bb outside any component of ours, so it asks through this
// module and the mounted dialogs answer.
import { useEffect } from "react";
import type { ProjectDialogKind } from "./model/menu";

function channel<T>() {
  const listeners = new Set<(request: T) => void>();
  return {
    send(request: T): void {
      for (const listener of [...listeners]) listener(request);
    },
    useListener(listener: (request: T) => void): void {
      useEffect(() => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }, [listener]);
    },
  };
}

const parent = channel<string>();
const project = channel<{ kind: ProjectDialogKind; projectId: string }>();

/** Opens the Parent… dialog for a thread. */
export const requestParentDialog = parent.send;
export const useParentRequests = parent.useListener;

/** Opens the rename, add-local-path or remove dialog for a project. */
export const requestProjectDialog = (kind: ProjectDialogKind, projectId: string) => project.send({ kind, projectId });
export const useProjectRequests = project.useListener;
