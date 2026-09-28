// The project's default branch, and whether a thread's branch is another
// one. Pure.

/** A project source as `projects.get` returns it, narrowed to what the lookup reads. */
export interface ProjectSourceRef {
  hostId: string;
  isDefault: boolean;
}

/**
 * The machine to ask for a project's default branch: its default source's,
 * else its first source's. Null when the project has no source, as a
 * personal project may not. A thread's own machine may have no source for
 * the project, and bb answers 404 there.
 */
export function defaultSourceHostId(sources: readonly ProjectSourceRef[]): string | null {
  return (sources.find((source) => source.isDefault) ?? sources[0])?.hostId ?? null;
}

/**
 * Whether a thread's branch is known to differ from its project's default:
 * `defaultBranch` is undefined while the lookup runs and null when it found
 * none, and in both cases the branch is not known to differ.
 */
export function isOffDefaultBranch(branch: string | null, defaultBranch: string | null | undefined): branch is string {
  return branch !== null && typeof defaultBranch === "string" && branch !== defaultBranch;
}
