// What a read of a fleet's manifest shows beyond what to watch: which sent
// actions are done, and which Inbox rows are new to the repository. Runs after
// each poll's and each turn-end read's reading, whatever the poll does next.
import { finishedActions, heldBy } from "../domain/actions";
import { inboxNews, unreadableInbox } from "../domain/dashboard";
import { formatRepo, repoId } from "../domain/identity";
import { uniqueRowIds } from "../domain/inbox";
import { CELL_MAX_CHARS, clip } from "../domain/text";
import { itemId, type ItemState, type ManifestRead, type Registration } from "../domain/model";
import { itemOfReference } from "../domain/watched";
import type { DashboardEvents, Store } from "./ports";

/** The fleet's identity as the watched set reads references against: its repository, tracker and forge. */
export const identityOf = (registration: Registration, forge: "github" | "gitlab") => ({ repo: registration.repo, tracker: registration.tracker, forge });

export interface Observed {
  readonly store: Store;
  readonly events: DashboardEvents;
}

/**
 * Marks as done the sent actions that `manifest` and `items` (what the poll read of each watched item, by item id,
 * before the cursors commit) show done, and announces each Inbox row never recorded for the repository once. The first
 * read since the fleet registered only records the rows. A manifest that is missing or unreadable shows neither. A row
 * that left the Inbox counts as done only from an Inbox read whole, with no row named unreadable; the ready label does
 * not depend on the Inbox, so a Build it is done by it whatever rows cannot be read.
 * An action sent after `at` is left to the next read: this one's manifest may be older than the row.
 */
export function observeManifest(
  deps: Observed,
  registration: Registration,
  forge: "github" | "gitlab",
  manifest: ManifestRead,
  items: Readonly<Record<string, ItemState>>,
  at: string,
): void {
  if (manifest.status !== "ok") return;
  const repo = repoId(registration.repo);
  const ids = uniqueRowIds(manifest.manifest.inbox);

  const identity = identityOf(registration, forge);
  const ready = (ref: string): boolean => {
    const item = itemOfReference(ref, identity);
    return item !== null && (items[itemId(item.role, item.ref)]?.fleetLabels.includes(registration.labels.ready) ?? false);
  };
  // An action sent to a manager since replaced never reached the one that holds the fleet now.
  const sent = heldBy(deps.store.actions(repo), registration.managerThreadId).filter((action) => action.state === "sent" && action.sentAt <= at);
  const finished = finishedActions(sent, new Set(ids), unreadableInbox(manifest.manifest.unreadable).length === 0, ready);
  if (finished.length > 0) deps.store.markActionsDone(repo, finished, at);

  const baselined = deps.store.inboxBaselined(repo);
  const news = inboxNews(ids, deps.store.inboxSeen(repo), baselined);
  deps.store.touchInboxSeen(repo, ids, at);
  if (!baselined) deps.store.setInboxBaselined(repo);
  const announced = new Set(news.announce);
  manifest.manifest.inbox.forEach((row, index) => {
    if (announced.has(ids[index]!)) deps.events.inboxNew({ fleet: formatRepo(registration.repo), ref: row.ref, what: clip(row.what, CELL_MAX_CHARS), rowId: ids[index]!, waitsFor: row.waitsFor, forge });
  });
}
