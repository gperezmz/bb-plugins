// Hover card and details drawer content. Pure.
import type { Family, ThreadInfo } from "./families";
import type { StateKind } from "./state";

const SUMMARY_ORDER: readonly [StateKind, string][] = [
  ["waits-on-you", "needing you"],
  ["failed", "failed"],
  ["queue-failed", "queue failed"],
  ["offline", "offline"],
  ["working", "working"],
  ["background", "in background"],
  ["scheduled", "scheduled"],
  ["queued", "queued"],
  ["unread", "unread"],
  ["draft", "drafts"],
  ["idle", "idle"],
];

/** "2 working, 1 needing you, 3 idle": visible descendants by state. */
export function childSummary(descendants: readonly ThreadInfo[]): string | null {
  const counts = new Map<StateKind, number>();
  for (const info of descendants) {
    if (info.thread.isHidden) continue;
    counts.set(info.state.kind, (counts.get(info.state.kind) ?? 0) + 1);
  }
  const parts = SUMMARY_ORDER.filter(([kind]) => counts.has(kind)).map(
    ([kind, label]) => `${counts.get(kind)} ${label}`,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Descendants of `id` inside its family, for the card of any row. */
export function descendantsOf(family: Family | undefined, id: string): ThreadInfo[] {
  if (family === undefined) return [];
  if (family.root.thread.id === id) return family.descendants;
  const result: ThreadInfo[] = [];
  const within = new Set([id]);
  for (const info of family.descendants) {
    if (info.parentId !== null && within.has(info.parentId)) {
      within.add(info.thread.id);
      result.push(info);
    }
  }
  return result;
}

export function formatDateTime(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** How the card names the time in the current state. */
export function sinceLabel(kind: string, since: string | null): string | null {
  if (since === null) return null;
  const ago = since === "now" ? "just now" : `${since} ago`;
  switch (kind) {
    case "working":
    case "background":
      return `started ${ago}`;
    case "waits-on-you":
      return `waiting since ${ago}`;
    case "failed":
      return `failed ${ago}`;
    default:
      return `finished ${ago}`;
  }
}

/** The model's display name from the provider catalog, else its id. */
export function modelDisplayName(
  model: string,
  catalog: readonly { id: string; model: string; displayName: string }[],
): string {
  return catalog.find((entry) => entry.model === model || entry.id === model)?.displayName ?? model;
}
