// Each project's default branch, looked up once per list through the
// machine of the project's default source, and fed into the list store.
//
// Debt: the answers are kept for the list's life, with no refresh, because
// the SDK offers no cached query for a project's branches. It clears when
// the SDK does, or when a default branch changing mid-session matters.
import { useEffect, useRef } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { defaultSourceHostId } from "../model/branches";
import type { ListStore } from "../store/api";

/** Looks up the default branch of each project in `projectIds` not asked about yet. */
export function useDefaultBranches(store: ListStore, projectIds: readonly string[]): void {
  const sdk = useSdk();
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const projectId of projectIds) {
      if (requested.current.has(projectId)) continue;
      requested.current.add(projectId);
      const settle = (branch: string | null) =>
        store.feed(({ defaultBranches }) => ({ defaultBranches: new Map(defaultBranches).set(projectId, branch) }));
      sdk.projects
        .get({ projectId })
        .then(async (project) => {
          const hostId = defaultSourceHostId(project.sources);
          if (hostId === null) return null;
          const result = await sdk.projects.branches({ projectId, hostId, limit: "1" });
          return result.defaultBranch ?? null;
        })
        .then(settle, () => settle(null));
    }
  }, [projectIds, sdk, store]);
}
