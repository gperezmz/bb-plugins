// Transient auto-expansion. Transitions are diffed against the previous
// render, as bb does; nothing here is persisted.
import { useCallback, useRef, useState } from "react";
import type { Forest } from "../model/families";
import {
  detectTransitions,
  mergeTargets,
  pruneTargets,
  snapshotOf,
  type Snapshot,
  type Targets,
} from "../model/expansion";

export interface AutoExpand {
  targets: Targets;
  /** A user's collapse: drop targets it hides, until the next transition. */
  prune(drop: (id: string) => boolean): void;
}

export function useAutoExpand(forest: Forest | null, activeThreadId: string | null): AutoExpand {
  const previous = useRef<Snapshot | null>(null);
  const lastForest = useRef<Forest | null>(null);
  const lastActive = useRef<string | null | undefined>(undefined);
  const [targets, setTargets] = useState<Targets>(() => new Map());
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  // Derived during render so the first paint is already expanded. Idempotent:
  // a repeated render diffs against the snapshot it stored.
  let current = targets;
  if (forest !== null && (forest !== lastForest.current || activeThreadId !== lastActive.current)) {
    const snapshot = snapshotOf(forest, activeThreadId);
    const added = detectTransitions(previous.current, snapshot);
    previous.current = snapshot;
    lastForest.current = forest;
    lastActive.current = activeThreadId;
    current = mergeTargets(targets, added);
    if (current !== targets) {
      targetsRef.current = current;
      setTargets(current);
    }
  }

  const prune = useCallback((drop: (id: string) => boolean) => {
    const next = pruneTargets(targetsRef.current, drop);
    if (next !== targetsRef.current) {
      targetsRef.current = next;
      setTargets(next);
    }
  }, []);

  return { targets: current, prune };
}
