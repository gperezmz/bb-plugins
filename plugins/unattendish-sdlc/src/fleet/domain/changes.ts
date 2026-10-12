// Turning what a source read into changes: a pure comparison of the read
// against the cursor the source kept, with no clock, no I/O and no opinion
// on whether a change wakes anyone.
import {
  itemId,
  type Change,
  type ChangeKind,
  type ChecksOutcome,
  type FleetLabels,
  type ItemSnapshot,
  type ItemState,
  type ReadFailure,
  type ReadOutcome,
  type SourceCursor,
  type SourceRole,
  type Transition,
  type WatchedItem,
} from "./model";

const DEFAULT_OVERLAP_MS = 60_000;
/**
 * The furthest a failed read may hold a cursor's `since` back from the poll's start while the rest of the source
 * reads, so one item that never reads cannot make every later poll read ever more.
 */
export const MAX_HOLD_MS = 7 * 24 * 3_600_000;

export interface DeriveInput {
  readonly role: SourceRole;
  /** The cursor the source kept, or null before its first poll. */
  readonly prev: SourceCursor | null;
  readonly outcome: ReadOutcome;
  /** The refs of this source whose comments, reviews, state and checks matter. */
  readonly watchedRefs: ReadonlySet<string>;
  readonly labels: FleetLabels;
  /** When the poll began (ISO 8601 UTC). */
  readonly startedAt: string;
  /** The cursor's `since` when `prev` is null: the registration time. */
  readonly firstSince: string;
  /**
   * The read only took the state of the items: it records a baseline and reports nothing. The baseline of an item
   * the cursor does not know is its state before the transitions its snapshot lists, so the next poll reports them.
   */
  readonly stateOnly: boolean;
  /** How far before `startedAt` the next cursor reaches, so an event the service lists late is still read. Defaults to 60 seconds. */
  readonly overlapMs?: number;
}

/** An item the service listed as updated that is not in the watched set. */
export interface UpdatedObservation {
  readonly key: string;
  readonly role: SourceRole;
  readonly ref: string;
  readonly url: string;
  readonly at: string;
}

export interface Derived {
  /** Sorted by time, then key. */
  readonly changes: Change[];
  readonly outOfScope: UpdatedObservation[];
  /** What the source keeps once a wake carrying `changes` is accepted. */
  readonly nextCursor: SourceCursor;
  readonly failures: ReadFailure[];
}

/**
 * The changes a read shows against the previous cursor. A change's key does
 * not depend on when it is derived: deriving again from the same, uncommitted
 * cursor gives the same keys. An item whose read failed leaves its previous
 * state in the cursor and gives no change. Such a failure, and a failed
 * listing, hold `since` where it was, so a failed read never lets the cursor
 * skip a change. While some snapshot, event or updated item came back, the
 * hold reaches no more than `MAX_HOLD_MS` before the poll's start: one item
 * that never reads cannot hold the source back for good. While nothing came
 * back, the hold has no limit. A failure of one item of kind `not-found` or
 * `outside-fleet` holds nothing, since no later read of that item will
 * succeed.
 */
export const deriveChanges = (input: DeriveInput): Derived => {
  const { role, prev, outcome, watchedRefs, labels, startedAt, firstSince, stateOnly } = input;
  const overlapMs = input.overlapMs ?? DEFAULT_OVERLAP_MS;
  const base = prev?.since ?? firstSince;
  const failedRefs = new Set(outcome.failures.flatMap((failure) => (failure.ref === null ? [] : [failure.ref])));

  const changes: Change[] = [];
  const items: Record<string, ItemState> = {};

  for (const snapshot of outcome.snapshots) {
    if (failedRefs.has(snapshot.ref)) continue;
    const id = itemId(role, snapshot.ref);
    const before = prev?.items[id];
    const watched = watchedRefs.has(snapshot.ref);
    if (!stateOnly) changes.push(...snapshotChanges({ snapshot, before, watched, labels, startedAt, base, id }));
    // A closed item nobody watches is not read again: the partition listings name open items only.
    if (watched || snapshot.open) items[id] = stateOnly && before === undefined ? rewound(nextState(snapshot, before), snapshot.transitions) : nextState(snapshot, before);
  }

  if (!stateOnly) {
    for (const event of outcome.events) {
      if (!watchedRefs.has(event.ref)) continue;
      changes.push({ key: event.id, role: event.role, ref: event.ref, url: event.url, kind: event.kind, label: null, actor: event.actor, at: event.at, lastLine: event.lastLine, ...aliasesOf(event) });
    }
  }

  const outOfScope = outcome.updated
    .filter((updated) => !watchedRefs.has(updated.ref))
    .map((updated) => ({ key: `updated:${updated.ref}@${updated.at}`, role: updated.role, ref: updated.ref, url: updated.url, at: updated.at }));

  for (const ref of failedRefs) {
    const id = itemId(role, ref);
    const before = prev?.items[id];
    if (before !== undefined) items[id] = before;
  }
  if (stateOnly) {
    for (const [id, state] of Object.entries(prev?.items ?? {})) if (!(id in items)) items[id] = state;
  }

  const holdsSince = outcome.failures.some((failure) => failure.ref === null || !isTerminal(failure)) || stateOnly;
  const readable = outcome.snapshots.length > 0 || outcome.events.length > 0 || outcome.updated.length > 0;
  const oldest = new Date(Date.parse(startedAt) - MAX_HOLD_MS).toISOString();
  const since = !holdsSince ? new Date(Date.parse(startedAt) - overlapMs).toISOString() : readable && base < oldest ? oldest : base;

  changes.sort(byTimeThenKey);
  return { changes, outOfScope, nextCursor: { since, items }, failures: [...outcome.failures] };
};

/**
 * How a source's read failed as a whole, or null when it did not: it gave no
 * snapshot, no event and no updated item, and gave failures, every one of
 * them `forbidden` or `unreachable`. Forbidden when any of them is.
 */
export const unreadableKind = (outcome: ReadOutcome): "forbidden" | "unreachable" | null => {
  if (outcome.snapshots.length > 0 || outcome.events.length > 0 || outcome.updated.length > 0 || outcome.failures.length === 0) return null;
  if (!outcome.failures.every((failure) => failure.kind === "forbidden" || failure.kind === "unreachable")) return null;
  return outcome.failures.some((failure) => failure.kind === "forbidden") ? "forbidden" : "unreachable";
};

/** Orders changes, and ledger rows, by the time they happened, then by key. */
export const byTimeThenKey = (a: { readonly at: string; readonly key: string }, b: { readonly at: string; readonly key: string }): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/**
 * The items a poll must read again though the watched set no longer names
 * them: those the previous cursor held open, in the operator's partition,
 * with the spec or ready label, so a label lost since is seen even when a
 * listing no longer shows the item. A closed one is left alone, so every
 * finished spec that keeps its label is not read on every poll.
 */
export const partitionRevisit = (prev: SourceCursor | null, role: SourceRole, labels: FleetLabels, watchedRefs: ReadonlySet<string>): WatchedItem[] => {
  const head = `${role}:`;
  const revisit: WatchedItem[] = [];
  for (const [id, state] of Object.entries(prev?.items ?? {})) {
    if (!id.startsWith(head)) continue;
    const ref = id.slice(head.length);
    if (watchedRefs.has(ref) || !state.inPartition || !state.open) continue;
    if (state.fleetLabels.includes(labels.spec) || state.fleetLabels.includes(labels.ready)) revisit.push({ role, ref, url: null });
  }
  return revisit;
};

interface SnapshotContext {
  readonly snapshot: ItemSnapshot;
  readonly before: ItemState | undefined;
  readonly watched: boolean;
  readonly labels: FleetLabels;
  readonly startedAt: string;
  /** The `since` the cursor would hold if this poll were not committed. */
  readonly base: string;
  readonly id: string;
}

const snapshotChanges = (context: SnapshotContext): Change[] => {
  const { snapshot, before, watched, labels, id } = context;
  const changes: Change[] = [];
  const make = (kind: ChangeKind, label: string | null, transition: Transition | undefined): Change => ({
    key: `${id}|${kind}${label === null ? "" : `:${label}`}|${transition?.id ?? `since:${context.base}`}`,
    role: snapshot.role,
    ref: snapshot.ref,
    url: snapshot.url,
    kind,
    label,
    actor: transition?.actor ?? null,
    at: transition?.at ?? context.startedAt,
    lastLine: null,
    ...(transition === undefined ? {} : aliasesOf(transition)),
  });

  const registered: readonly { readonly label: string; readonly partitioned: boolean }[] = [
    { label: labels.spec, partitioned: true },
    { label: labels.ready, partitioned: true },
    { label: labels.inProgress, partitioned: false },
    { label: labels.needsInput, partitioned: false },
  ];
  for (const { label, partitioned } of registered) {
    const has = snapshot.fleetLabels.includes(label);
    if (before === undefined) {
      if (has && partitioned && snapshot.inPartition) changes.push(make("labelled", label, latest(snapshot.transitions, "labelled", label)));
      continue;
    }
    const had = before.fleetLabels.includes(label);
    if (had === has || !(watched || (partitioned && snapshot.inPartition))) continue;
    const kind = has ? "labelled" : "unlabelled";
    changes.push(make(kind, label, latest(snapshot.transitions, kind, label)));
  }

  if (watched && before !== undefined) {
    if (before.open && !snapshot.open) {
      const kind = snapshot.merged && !before.merged ? "merged" : "closed";
      changes.push(make(kind, null, latest(snapshot.transitions, kind, null)));
    } else if (!before.open && snapshot.open) {
      changes.push(make("reopened", null, latest(snapshot.transitions, "reopened", null)));
    }
  }

  const checks = snapshot.checks;
  if (watched && before !== undefined && checks !== null && checks.outcome !== "pending") {
    const known = before.checks !== null && before.checks.sha === checks.sha ? before.checks : null;
    if (known === null || !known.reported) {
      const kind: ChangeKind = checks.outcome === "passed" ? "checks passed" : "checks failed";
      const round = known?.round ?? 0;
      changes.push({ ...make(kind, null, undefined), key: `${id}|${kind}|${checks.sha}${round === 0 ? "" : `|round ${round}`}` });
    }
  }
  return changes;
};

/**
 * The item's state to keep. Final checks are kept as reported: they were
 * reported just now, before, or are a baseline nobody is told of. A pending
 * seen after a reported final on the same commit is a re-run: it opens the
 * next round, so the re-run's final outcome is reported under its own key.
 * A re-run that no poll saw pending is not reported, since nothing tells it
 * from the outcome already reported.
 */
const nextState = (snapshot: ItemSnapshot, before: ItemState | undefined): ItemState => {
  const checks = snapshot.checks;
  let kept: ItemState["checks"] = null;
  if (checks !== null) {
    const known = before?.checks != null && before.checks.sha === checks.sha ? before.checks : null;
    const round = (known?.round ?? 0) + (known?.reported === true && !isFinal(checks.outcome) ? 1 : 0);
    kept = { sha: checks.sha, outcome: checks.outcome, reported: isFinal(checks.outcome), ...(round === 0 ? {} : { round }) };
  }
  return { open: snapshot.open, merged: snapshot.merged, fleetLabels: [...snapshot.fleetLabels], checks: kept, inPartition: snapshot.inPartition };
};

/**
 * The state before the transitions, undone from the latest back: a label
 * gained is taken off, one lost put back, a close or merge opens the item
 * again and a reopen closes it. The poll after a turn-end read then reports
 * what the manager's turn did, each change under its transition's id.
 */
const rewound = (state: ItemState, transitions: readonly Transition[]): ItemState => {
  let { open, merged } = state;
  const fleetLabels = [...state.fleetLabels];
  const latestFirst = transitions.map((transition, at) => ({ transition, at })).sort((a, b) => (a.transition.at < b.transition.at ? 1 : a.transition.at > b.transition.at ? -1 : b.at - a.at));
  for (const { transition } of latestFirst) {
    const label = transition.label;
    if (transition.kind === "labelled" && label !== undefined) {
      const at = fleetLabels.indexOf(label);
      if (at >= 0) fleetLabels.splice(at, 1);
    } else if (transition.kind === "unlabelled" && label !== undefined) {
      if (!fleetLabels.includes(label)) fleetLabels.push(label);
    } else if (transition.kind === "closed" || transition.kind === "merged") {
      open = true;
      merged = false;
    } else if (transition.kind === "reopened") {
      open = false;
    }
  }
  return { ...state, open, merged, fleetLabels };
};

/** The other names the service knows an actor by, as the field of a `Change`; nothing when there are none. */
const aliasesOf = (source: { readonly actorAliases?: readonly string[] | undefined }): { readonly actorAliases?: readonly string[] } =>
  source.actorAliases === undefined || source.actorAliases.length === 0 ? {} : { actorAliases: [...source.actorAliases] };

/** A failure no later read can undo: the item is gone, or lies outside the fleet. */
const isTerminal = (failure: ReadFailure): boolean => failure.kind === "not-found" || failure.kind === "outside-fleet";

const isFinal = (outcome: ChecksOutcome): boolean => outcome !== "pending";

/** The transition of this kind (and label) that happened last; the last listed of equal times. */
const latest = (transitions: readonly Transition[], kind: Transition["kind"], label: string | null): Transition | undefined => {
  let found: Transition | undefined;
  for (const transition of transitions) {
    if (transition.kind !== kind || (label !== null && transition.label !== label)) continue;
    if (found === undefined || transition.at >= found.at) found = transition;
  }
  return found;
};
