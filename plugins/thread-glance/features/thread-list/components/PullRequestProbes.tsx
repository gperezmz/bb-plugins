// Looks up the pull request of every thread settling has to know about and
// reports each answer. Draws nothing: the host shares one lookup per
// environment with the badges that ask for the same threads.
import { memo, useEffect } from "react";
import { experimental_useSidebarThreadPullRequest as usePullRequest } from "@get-bb/plugin-sdk/app";
import type { PullRequestState } from "../model/settled";

type Answer = (threadId: string, state: PullRequestState | null) => void;

const Probe = memo(function Probe({ threadId, onAnswer }: { threadId: string; onAnswer: Answer }) {
  const { isLoading, pullRequest } = usePullRequest(threadId);
  const state = isLoading ? undefined : (pullRequest?.state ?? null);
  useEffect(() => {
    if (state !== undefined) onAnswer(threadId, state);
  }, [threadId, state, onAnswer]);
  return null;
});

export function PullRequestProbes({ threadIds, onAnswer }: { threadIds: readonly string[]; onAnswer: Answer }) {
  return (
    <>
      {threadIds.map((threadId) => (
        <Probe key={threadId} threadId={threadId} onAnswer={onAnswer} />
      ))}
    </>
  );
}
