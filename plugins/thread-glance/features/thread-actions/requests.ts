// Requests from the thread menu to the dialogs the app mounts once. The menu
// is evaluated by bb outside any component of ours, so it asks through this
// module and the mounted dialogs answer; a request nobody answers is toasted.
import { createDialogRequests } from "@/lib/dialog-requests";
import type { ProjectDialogKind } from "./model/menu";

const parent = createDialogRequests<string>();
const project = createDialogRequests<{ kind: ProjectDialogKind; projectId: string }>();

/** Opens the Parent… dialog for a thread. */
export const requestParentDialog = parent.request;
export const useParentRequests = parent.useListener;

/** Opens the rename, add-local-path or remove dialog for a project. */
export const requestProjectDialog = (kind: ProjectDialogKind, projectId: string) => project.request({ kind, projectId });
export const useProjectRequests = project.useListener;
