import { useState } from "react";
import type { Endpoint } from "@/src/endpoints";
import { useEndpointsApi } from "./client";
import { Button } from "./controls";
import { EndpointCard } from "./EndpointCard";
import { NO_ENDPOINTS } from "./model";
import { useSaved } from "./use-saved";

/**
 * The plugin's Endpoints section: one card per Endpoint, and Add Endpoint. bb draws the heading and the line under it from the registration; leaving the page drops whatever was not saved.
 */
export function EndpointsSettings() {
  const api = useEndpointsApi();
  const { state, replace } = useSaved(api);
  const [adding, setAdding] = useState(false);
  // A card draws again, from what was saved, each time a change to it is saved.
  const [versions, setVersions] = useState<Record<string, number>>({});

  if (state.status === "loading") return <p className="text-sm text-muted-foreground">Loading the Endpoints…</p>;
  if (state.status === "failed") {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        Could not load the Endpoints: {state.message}
      </p>
    );
  }

  const { endpoints, notice } = state.saved;
  const changed = (id: string) => (next: Endpoint[]) => {
    setVersions((was) => ({ ...was, [id]: (was[id] ?? 0) + 1 }));
    setAdding(false);
    replace(next);
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      {notice !== null ? (
        <p role="status" className="rounded-md border border-border bg-secondary px-3 py-2 text-xs">
          {notice}
        </p>
      ) : null}
      {endpoints.length === 0 && !adding ? <p className="text-muted-foreground">{NO_ENDPOINTS}</p> : null}
      <ul className="flex flex-col gap-3">
        {endpoints.map((endpoint) => (
          <EndpointCard key={`${endpoint.id}:${versions[endpoint.id] ?? 0}`} saved={endpoint} api={api} onChanged={changed(endpoint.id)} onDiscard={() => undefined} />
        ))}
        {adding ? <EndpointCard key="new" saved={null} api={api} onChanged={changed("")} onDiscard={() => setAdding(false)} /> : null}
      </ul>
      <div>
        <Button disabled={adding} onClick={() => setAdding(true)}>
          Add Endpoint
        </Button>
      </div>
    </div>
  );
}
