// Server state: the Endpoints as saved, fetched once when the section opens and replaced by what each change returns.
import { useCallback, useEffect, useState } from "react";
import type { Endpoint } from "@/src/endpoints";
import { messageOf, type EndpointsApi, type Saved } from "./client";

export type SavedState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; saved: Saved };

export function useSaved(api: EndpointsApi): { state: SavedState; replace(endpoints: Endpoint[]): void } {
  const [state, setState] = useState<SavedState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    api.endpoints().then(
      (saved) => current && setState({ status: "ready", saved }),
      (error: unknown) => current && setState({ status: "failed", message: messageOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [api]);
  const replace = useCallback(
    (endpoints: Endpoint[]) => setState((was) => (was.status === "ready" ? { status: "ready", saved: { ...was.saved, endpoints } } : was)),
    [],
  );
  return { state, replace };
}
