// The dialogs the thread menu opens, mounted once for the whole app. Each
// stays unmounted until asked for, so a closed one reads nothing from bb.
import { useCallback, useState } from "react";
import { useSnoozePickerRequests } from "@/features/thread-list";
import type { ProjectDialogKind } from "../model/menu";
import { useParentRequests, useProjectRequests } from "../requests";
import { ParentDialog } from "./ParentDialog";
import { ProjectDialog } from "./ProjectDialogs";
import { SnoozeDialog } from "./SnoozeDialog";

export function ThreadActionDialogs() {
  const [snooze, setSnooze] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [project, setProject] = useState<{ kind: ProjectDialogKind; projectId: string } | null>(null);
  useSnoozePickerRequests(setSnooze);
  useParentRequests(setParent);
  useProjectRequests(setProject);
  const closeSnooze = useCallback(() => setSnooze(null), []);
  const closeParent = useCallback(() => setParent(null), []);
  const closeProject = useCallback(() => setProject(null), []);
  return (
    <>
      {snooze !== null ? <SnoozeDialog key={snooze} threadId={snooze} onClose={closeSnooze} /> : null}
      {parent !== null ? <ParentDialog key={parent} threadId={parent} onClose={closeParent} /> : null}
      {project !== null ? <ProjectDialog key={`${project.kind}:${project.projectId}`} {...project} onClose={closeProject} /> : null}
    </>
  );
}
