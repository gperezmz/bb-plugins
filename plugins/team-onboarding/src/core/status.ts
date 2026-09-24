// The status model: from check outcomes to item statuses, the badge, the
// Next step card, the progress ring and the home section's one line.
import type { Group, ItemDef, ItemResult, Outcome, Scope, Status } from "./model.js";

export interface Machine {
  id: string;
  name: string;
  isServer: boolean;
  online: boolean;
  /** Persistent machines have no short-lived provider lifecycle. */
  persistent: boolean;
  lastSeenAt: string | null;
}

const LONG_OFFLINE_MS = 7 * 24 * 60 * 60 * 1000;

/** Machines offline for over a week are skipped until they come back. */
export function isLongOffline(machine: Machine, now: number): boolean {
  if (machine.online || machine.lastSeenAt === null) return false;
  return now - Date.parse(machine.lastSeenAt) > LONG_OFFLINE_MS;
}

/** The machines an item runs on. `all` means persistent machines. */
export function resolveScope(scope: Scope, machines: readonly Machine[]): Machine[] {
  if (scope === "server") return machines.filter((machine) => machine.isServer);
  if (scope === "all") return machines.filter((machine) => machine.persistent || machine.isServer);
  const names = new Set(scope);
  return machines.filter((machine) => names.has(machine.name) || names.has(machine.id));
}

/** A check outcome becomes a status; history decides `todo` versus `broken`. */
export function statusFromOutcome(outcome: Outcome, everPassed: boolean): Status {
  switch (outcome) {
    case "pass":
      return "ok";
    case "fail":
      return everPassed ? "broken" : "todo";
    case "update":
      return "update";
    case "needs-approval":
      return "needs-approval";
    case "error":
      return "unknown";
  }
}

const SEVERITY: Record<Status, number> = {
  broken: 5,
  "needs-approval": 4,
  todo: 3,
  update: 2,
  ok: 1,
  unknown: 0,
  skipped: -1,
};

/**
 * The worst status over the in-scope, online machines. `unknown` and
 * `skipped` never make an item fail; with nothing else, `unknown` wins over
 * `skipped`, and an item with no results at all is `todo`.
 */
export function aggregateStatus(statuses: readonly Status[]): Status {
  let worst: Status | null = null;
  for (const status of statuses) {
    if (status === "unknown" || status === "skipped") continue;
    if (worst === null || SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  if (worst !== null) return worst;
  if (statuses.includes("unknown")) return "unknown";
  if (statuses.length > 0) return "skipped";
  return "todo";
}

export interface ItemView {
  item: ItemDef;
  status: Status;
  /** One result per machine bb knows, `skipped` where out of scope. */
  results: ItemResult[];
}

/** Builds each item's per-machine results and its aggregate status. */
export function buildItemViews(
  items: readonly ItemDef[],
  machines: readonly Machine[],
  stored: ReadonlyMap<string, ItemResult>,
  now: number,
): ItemView[] {
  return items.map((item) => {
    const inScope = new Set(resolveScope(item.scope, machines).map((machine) => machine.id));
    const results = machines.map((machine): ItemResult => {
      const key = resultKey(item.id, machine.id);
      const previous = stored.get(key);
      if (!inScope.has(machine.id) || isLongOffline(machine, now)) {
        return {
          itemId: item.id,
          hostId: machine.id,
          status: "skipped",
          category: inScope.has(machine.id) ? "long-offline" : "out-of-scope",
          checkedAt: previous?.checkedAt ?? null,
          detail: inScope.has(machine.id)
            ? `${machine.name} has been offline for over a week.`
            : `Not needed on ${machine.name}.`,
          facts: {},
        };
      }
      if (!machine.online) {
        return {
          itemId: item.id,
          hostId: machine.id,
          status: "unknown",
          category: "offline",
          checkedAt: previous?.checkedAt ?? null,
          detail: `Can't check, ${machine.name} is offline.`,
          facts: previous?.facts ?? {},
        };
      }
      return (
        previous ?? {
          itemId: item.id,
          hostId: machine.id,
          status: "todo",
          category: "not-checked",
          checkedAt: null,
          detail: "Not checked yet.",
          facts: {},
        }
      );
    });
    return { item, status: aggregateStatus(results.map((result) => result.status)), results };
  });
}

export function resultKey(itemId: string, hostId: string): string {
  return `${itemId}@${hostId}`;
}

const BLOCKING: ReadonlySet<Status> = new Set(["todo", "broken", "needs-approval"]);

export type Badge =
  | { kind: "count"; count: number }
  | { kind: "dot"; updates: number }
  | { kind: "done" };

/** The sidebar badge: blocking required items, a dot for updates, or done. */
export function badgeFor(views: readonly ItemView[]): Badge {
  const required = views.filter((view) => view.item.required);
  const blocking = required.filter((view) => BLOCKING.has(view.status)).length;
  if (blocking > 0) return { kind: "count", count: blocking };
  const updates = required.filter((view) => view.status === "update").length;
  if (updates > 0) return { kind: "dot", updates };
  return { kind: "done" };
}

/** Dependency order for the Next step card. */
function priority(view: ItemView): number {
  const id = view.item.id;
  if (
    id === "github.gh-installed" ||
    id === "github.login" ||
    id === "github.builtin-git" ||
    id === "github.mode"
  )
    return 0;
  if (id === "core.manifest") return 1;
  if (view.item.group === "skills") return 2;
  if (view.item.group === "agents") return 3;
  return 4 + GROUP_ORDER.indexOf(view.item.group);
}

const GROUP_ORDER: readonly Group[] = [
  "github",
  "ssh",
  "agents",
  "skills",
  "plugins",
  "tools",
  "env",
  "team",
];

/** The first `todo` or `broken` required item, in dependency order. */
export function nextStep(views: readonly ItemView[]): ItemView | null {
  const candidates = views
    .map((view, index) => ({ view, index }))
    .filter(({ view }) => view.item.required && (view.status === "todo" || view.status === "broken"));
  candidates.sort(
    (a, b) => priority(a.view) - priority(b.view) || a.index - b.index,
  );
  return candidates[0]?.view ?? null;
}

export interface Progress {
  done: number;
  total: number;
}

/** `12 of 15`: required items that pass, out of required items in scope. */
export function progress(views: readonly ItemView[]): Progress {
  const required = views.filter((view) => view.item.required && view.status !== "skipped");
  return {
    done: required.filter((view) => view.status === "ok").length,
    total: required.length,
  };
}

/** The home section's line. */
export function homeLine(views: readonly ItemView[], lastCheckAt: string | null, now: number): string {
  const badge = badgeFor(views);
  if (badge.kind === "count") {
    return `${badge.count} setup ${badge.count === 1 ? "step" : "steps"} left`;
  }
  if (badge.kind === "dot") {
    return `${badge.updates} ${badge.updates === 1 ? "update" : "updates"} available`;
  }
  return lastCheckAt === null ? "All set" : `All set · checked ${timeAgo(lastCheckAt, now)}`;
}

export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** "3 team skills, Claude Code and Codex on 2 machines" for the done state. */
export function doneSummary(views: readonly ItemView[], machines: readonly Machine[]): string {
  const skills = views
    .filter((view) => view.item.group === "skills" && view.status === "ok")
    .reduce((sum, view) => {
      const count = view.results.find((result) => result.facts.skillCount !== undefined)?.facts
        .skillCount;
      return sum + (typeof count === "number" ? count : 0);
    }, 0);
  const agents = views
    .filter((view) => view.item.group === "agents" && view.status === "ok")
    .map((view) => view.item.title);
  const online = machines.filter((machine) => machine.online).length;
  const parts: string[] = [];
  if (skills > 0) parts.push(`${skills} team ${skills === 1 ? "skill" : "skills"}`);
  if (agents.length > 0) {
    parts.push(`${joinWords(agents)} on ${online} ${online === 1 ? "machine" : "machines"}`);
  }
  return parts.length === 0 ? "Everything your team asks for is in place." : parts.join(", ");
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
