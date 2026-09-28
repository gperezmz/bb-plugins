// Each project's default branch, looked up once per list through the
// machine of the project's default source.
import { useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { defaultSourceHostId } from "../model/branches";

/** Project id → default branch; undefined while unknown, null when the lookup found none. */
export type DefaultBranches = ReadonlyMap<string, string | null>;

export function useDefaultBranches(projectIds: readonly string[]): DefaultBranches {
  const sdk = useSdk();
  const [branches, setBranches] = useState<DefaultBranches>(() => new Map());
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const projectId of projectIds) {
      if (requested.current.has(projectId)) continue;
      requested.current.add(projectId);
      const settle = (branch: string | null) => setBranches((current) => new Map(current).set(projectId, branch));
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
  }, [projectIds, sdk]);
  return branches;
}
