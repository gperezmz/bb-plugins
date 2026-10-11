// Mounts the drag controller on the list's root element.
import { useEffect, type RefObject } from "react";
import { useCommands, useListStore } from "../../store/hooks";
import { createDragController } from "./drag-controller";

export function useReorderDrag(root: RefObject<HTMLElement | null>): void {
  const commands = useCommands();
  const store = useListStore();
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const controller = createDragController({ root: element, commands, model: () => store.getState().model });
    return () => controller.dispose();
  }, [root, commands, store]);
}
