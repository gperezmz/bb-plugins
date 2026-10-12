import type { ReactNode } from "react";
import { screenState, type Live } from "./use-live";

/** Draws the three states of a fetched view: waiting, failed, and ready (with a note where a later refresh failed). */
export function LiveScreen<T>({ live, what, children }: { live: Pick<Live<T>, "data" | "error">; what: string; children(data: T): ReactNode }) {
  const state = screenState(live);
  if (state === "loading") return <p className="text-sm text-muted-foreground">Loading {what}…</p>;
  if (state === "failed") return <p role="alert" className="text-sm text-destructive">Could not load {what}: {live.error}</p>;
  return (
    <>
      {live.error !== null ? (
        <p role="alert" className="mb-3 text-xs text-warning">
          Could not refresh {what}: {live.error}
        </p>
      ) : null}
      {children(live.data as T)}
    </>
  );
}
