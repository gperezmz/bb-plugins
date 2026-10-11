// The ids of the projects the list draws, for rows to compute project colours
// from without reading bb's list hook.
import { useRef } from "react";
import { useListStore, useSelect } from "../store/hooks";

export function useProjectIds(): readonly string[] {
  const store = useListStore();
  const last = useRef<readonly string[]>([]);
  return useSelect(store, (state) => {
    const projects = state.inputs.host.projects;
    const previous = last.current;
    if (previous.length === projects.length && previous.every((id, index) => id === projects[index]!.id)) return previous;
    last.current = projects.map((project) => project.id);
    return last.current;
  });
}
