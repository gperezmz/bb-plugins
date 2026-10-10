import { createContext, useContext } from "react";

/** Whether bb calls the viewport compact: the list is handed it as `isCompactViewport`. */
export const CompactViewportContext = createContext(false);

export function useIsCompactViewport(): boolean {
  return useContext(CompactViewportContext);
}
