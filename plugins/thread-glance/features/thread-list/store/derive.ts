// The list store's derive step: the inputs the list is drawn from, and the
// model built from them with whatever did not change kept as it was.
import type { PluginSidebarProject, PluginSidebarSplitLayout, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { LifecycleRow, Shelf } from "@/shared/lifecycle";
import type { Settings } from "@/shared/settings";
import { buildModel, SETTLED_FIRST_PAGE, type DragPreview, type ListModel, type RowView } from "../model/list-model";
import { resolveScope, type Scope } from "../model/scope";
import { share } from "../model/share";
import type { DeviceState } from "../storage/device-state";

/** What bb's hooks report about the list. */
export interface HostData {
  status: "loading" | "ready" | "error";
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  draftIds: ReadonlySet<string>;
  splitLayout: PluginSidebarSplitLayout | null;
}

export const NO_HOST: HostData = {
  status: "loading",
  threads: [],
  projects: [],
  draftIds: new Set(),
  splitLayout: null,
};

/** Everything the model is built from, and what the store checks before it publishes one. */
export interface ListInputs {
  host: HostData;
  activeThreadId: string | null;
  compact: boolean;
  /** The server's lifecycle rows, or the browser's cache of them until the first answer. */
  lifecycle: Readonly<Record<string, LifecycleRow>>;
  /** Whether the rows can be drawn from: an answer, a cache, or a failed answer. */
  rowsReady: boolean;
  /** Whether the rows hold every mark there is: the server's, or a cache short of its cap; a cut cache or the defaults a failed answer leaves do not. */
  rowsComplete: boolean;
  settings: Settings;
  /** Manual order as the server holds it. */
  order: readonly string[];
  /** Manual order as a reorder wrote it, until the server's answer lands. */
  pendingOrder: readonly string[] | null;
  pinnedOverride: readonly string[] | null;
  device: DeviceState;
  /** The project scope this window chose; empty for All projects. */
  scope: Scope;
  now: number;
  settledShown: number;
  frozenShelves: ReadonlyMap<string, Shelf>;
  drag: DragPreview | null;
  /** The questions and queued failures you have opened threads on, on this device, until each clears (see `seenWaits`). */
  seenWaits: ReadonlySet<string>;
}

export const FIRST_SETTLED_SHOWN = SETTLED_FIRST_PAGE;

/** Threads other split panes show: every pane's thread but the focused pane's. */
function openElsewhere(layout: PluginSidebarSplitLayout | null): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const pane of layout?.panes ?? []) if (pane.threadId !== null && !pane.isFocused) ids.add(pane.threadId);
  return ids;
}

/** The scope in force: the chosen one without the projects bb no longer lists, once bb has listed them. */
export function scopeIn(inputs: Pick<ListInputs, "scope" | "host">): Scope {
  return resolveScope(inputs.scope, inputs.host.projects, inputs.host.status === "ready");
}

/** The model for `inputs`, or null while bb's threads or the server's rows are not there. */
export function derive(inputs: ListInputs, previous: ListModel | null): ListModel | null {
  if (inputs.host.status !== "ready" || !inputs.rowsReady) return null;
  const model = buildModel({
    threads: inputs.host.threads,
    projects: inputs.host.projects,
    lifecycle: inputs.lifecycle,
    settings: inputs.settings,
    order: inputs.pendingOrder ?? inputs.order,
    device: inputs.device,
    scope: scopeIn(inputs),
    activeThreadId: inputs.activeThreadId,
    draftIds: inputs.host.draftIds,
    openElsewhereIds: openElsewhere(inputs.host.splitLayout),
    seenWaits: inputs.seenWaits,
    now: inputs.now,
    compact: inputs.compact,
    settledShown: inputs.settledShown,
    frozenShelves: inputs.frozenShelves,
    pinnedOverride: inputs.pinnedOverride,
    drag: inputs.drag,
  });
  return previous === null ? model : shareModel(previous, model);
}

/** `next` with every part equal to the same part of `previous` kept as it was. */
export function shareModel(previous: ListModel, next: ListModel): ListModel {
  let rowsChanged = previous.rows.size !== next.rows.size;
  const rows = new Map<string, RowView>();
  for (const [id, row] of next.rows) {
    const before = previous.rows.get(id);
    const kept = before === undefined ? row : share(before, row);
    if (kept !== before) rowsChanged = true;
    rows.set(id, kept);
  }
  return {
    ...next,
    rows: rowsChanged ? rows : previous.rows,
    upper: share(previous.upper, next.upper),
    lower: share(previous.lower, next.lower),
    shelves: share(previous.shelves, next.shelves),
    pinnedWithRow: share(previous.pinnedWithRow, next.pinnedWithRow),
  };
}
