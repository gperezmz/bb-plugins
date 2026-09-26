// The list and the settings panel mount apart, each with its own copy of the
// preferences. A change made in one reaches the other here, in the same
// window, at once; the server and localStorage stay what other windows read.
import { useCallback, useEffect } from "react";

type Apply<Patch> = (patch: Patch) => void;

export function sameWindow<Patch>(): Set<Apply<Patch>> {
  return new Set();
}

/**
 * Joins this copy to `copies` for as long as it is mounted.
 *
 * Returns the call that hands a patch this copy made to every other copy.
 */
export function useSameWindow<State extends object>(
  copies: Set<Apply<Partial<State>>>,
  setState: (update: (current: State) => State) => void,
): Apply<Partial<State>> {
  const apply = useCallback((patch: Partial<State>) => setState((current) => ({ ...current, ...patch })), [setState]);
  useEffect(() => {
    copies.add(apply);
    return () => {
      copies.delete(apply);
    };
  }, [copies, apply]);
  return useCallback(
    (patch: Partial<State>) => {
      for (const other of copies) if (other !== apply) other(patch);
    },
    [copies, apply],
  );
}
