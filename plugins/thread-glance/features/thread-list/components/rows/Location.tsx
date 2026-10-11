// Where a thread runs: its branch (or worktree branch), else the machine.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export function Location({ thread }: { thread: PluginSidebarThread }) {
  const branch = thread.environment?.branchName;
  if (branch) {
    const worktree = thread.environment?.isWorktree === true;
    return (
      <span data-location="branch" className="flex min-w-0 flex-1 items-center gap-1 truncate">
        <Icon name={worktree ? "FolderGit" : "GitBranch"} aria-label={worktree ? "Worktree branch" : "Branch"} className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate font-mono">{branch}</span>
      </span>
    );
  }
  if (thread.host) {
    return (
      <span data-location="machine" className="flex min-w-0 flex-1 items-center gap-1 truncate">
        <Icon name="Computer" aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate">{thread.host.name}</span>
      </span>
    );
  }
  return <span className="flex-1" />;
}
