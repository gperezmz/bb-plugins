// The pull request lookups that answered, by thread id. Answers arriving in
// one burst (a list's worth of lookups on load) land in one state update.
//
// Debt: this copies server state the host's per-row pull request hook owns,
// because settling reads every thread's pull request at once and the SDK
// offers no query over many threads. It clears when the SDK does.
import { useCallback, useRef, useState } from "react";
import type { PullRequestState } from "../model/settled";

export type PullRequestAnswers = ReadonlyMap<string, PullRequestState | null>;

export function usePullRequestAnswers(): [PullRequestAnswers, (threadId: string, state: PullRequestState | null) => void] {
  const [answers, setAnswers] = useState<PullRequestAnswers>(() => new Map());
  const pending = useRef(new Map<string, PullRequestState | null>());
  const scheduled = useRef(false);
  const onAnswer = useCallback((threadId: string, state: PullRequestState | null) => {
    pending.current.set(threadId, state);
    if (scheduled.current) return;
    scheduled.current = true;
    setTimeout(() => {
      scheduled.current = false;
      const batch = pending.current;
      pending.current = new Map();
      setAnswers((current) => {
        let next: Map<string, PullRequestState | null> | null = null;
        for (const [id, value] of batch) {
          if (current.has(id) && current.get(id) === value) continue;
          next ??= new Map(current);
          next.set(id, value);
        }
        return next ?? current;
      });
    }, 0);
  }, []);
  return [answers, onAnswer];
}
