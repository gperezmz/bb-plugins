// The list view: groups, their counters and the flat rows
// each one renders. Components draw this; they decide nothing. Pure.
import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { Preferences } from "@/shared/preferences";
import { ancestorsOf, type ThreadTree, type Forest, type Subtree, type ThreadInfo } from "./trees";
import {
  builtinGroup,
  entityGroups,
  groupIdForRoot,
  isGroupCollapsed,
  ORDER_PREFERENCE,
  PINNED_GROUP_ID,
  resolveGroupOrder,
  THREADS_GROUP_ID,
  type GroupDescriptor,
} from "./groups";
import { addCounters, countTrees, EMPTY_COUNTERS, type Counters } from "./counters";
import { comparePinned, effectiveSortField, makeComparator, type SortKey } from "./sort";
import { isSettledTree, type SettleInputs } from "./settled";
import { isOffDefaultBranch } from "./branches";
import { mostUrgent, type Flag } from "./state";
import type { Targets } from "./expansion";
import type { RowNote } from "./notes";

/** How many quiet children stay in an expanded tree. */
export const KEEP_QUIET_CHILDREN = 3;

/** The children chip: the count of a parent's direct children and its chevron, after the state of its descendants. */
export interface Chip {
  /** Direct children opening it shows, hidden ones left out; 0 draws no number. */
  count: number;
  /** The user opened the chip, so every child shows. */
  expanded: boolean;
  /**
   * The most urgent state among the descendants at any depth, open or
   * collapsed, or null for none: its glyph leads the chip and colours it, and
   * keeps that colour through dimming and hover.
   */
  flag: Flag | null;
}

export interface ThreadRow {
  type: "thread";
  key: string;
  info: ThreadInfo;
  /** Visual depth: 0 for roots, one more per level below. */
  depth: number;
  /** Grandchild or deeper: draws `↳`. */
  nested: boolean;
  /** Title of the thread this one attaches to, for tooltips and labels. */
  parentTitle: string | null;
  chip: Chip | null;
  /**
   * The row draws its harness icon: a root whose harness is not bb's
   * default, a child whose harness is not its parent thread's.
   */
  harness: boolean;
  /** The title is bold: the thread is unread. */
  bold: boolean;
  /** A root whose tree holds an unread thread: it offers Mark read for the whole tree. */
  treeUnread: boolean;
  /** The line under the title: why it waits on you or failed, in both densities. */
  note: RowNote | null;
  /**
   * In Comfortable density, a row with no note whose branch is known not to
   * be its project's default draws that branch on its second line.
   */
  branchLine: string | null;
  /**
   * Where the pull request badge goes: after the branch on the second line,
   * on the title line (a root off its default branch, as before), or nowhere.
   */
  pullRequest: "second-line" | "title" | null;
  /** The machine's name, beside the age, for a thread off bb's primary machine. */
  machine: string | null;
  /** The title, and the chip with it, step back: see `isDimmed`. */
  dimmed: boolean;
  /** A hidden thread shown because it needs attention or failed. */
  hiddenBadge: boolean;
  /** "In project X" when the thread is outside its tree's group. */
  crossGroupLabel: string | null;
  projectId: string;
}

/** The fold inside an open tree: "N more child threads". */
export interface OlderRow {
  type: "older";
  key: string;
  /** The parent thread's id. */
  scopeId: string;
  /** `reveal`: an auto-reveal left `count` children hidden. */
  scope: "tree" | "reveal";
  count: number;
  expanded: boolean;
  depth: number;
}

export interface EnvironmentRow {
  type: "environment";
  key: string;
  environmentId: string;
  label: string;
  environmentProviderId: string | null;
  projectId: string;
  sectionId: string | null;
  threadIds: string[];
  collapsed: boolean;
  flag: Flag | null;
  depth: number;
}

/** A group's settled fold: the faint "Settled (N)" divider at its end. */
export interface SettledRow {
  type: "settled";
  key: string;
  groupId: string;
  /** Settled trees in the group, the open one drawn above the divider included. */
  count: number;
  expanded: boolean;
}

/** The rows a tree and its folders draw. */
export type TreeRow = ThreadRow | OlderRow | EnvironmentRow;

export type Row = TreeRow | SettledRow;

export interface GroupView {
  descriptor: GroupDescriptor;
  counters: Counters;
  /** What the user stored. */
  userCollapsed: boolean;
  /**
   * What is drawn: user collapse, unless opening a thread in the group
   * opened it. A collapsed group still draws its trees that need attention.
   */
  collapsed: boolean;
  hidden: boolean;
  rows: Row[];
  /** Every tree root bucketed in the group, those behind folds included. */
  rootIds: string[];
}

export interface ListView {
  groups: GroupView[];
  /** Hidden groups, shown in the More popover. */
  more: GroupView[];
  moreCounters: Counters;
  /** Resolved top-level order for the mode, for header drag. */
  order: string[];
  /** Thread trees that need attention, in every group, hidden ones included: the need-you filter's N. */
  needYouCount: number;
}

export interface ViewInputs {
  forest: Forest;
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  sections: readonly PluginSidebarSection[];
  prefs: Preferences;
  activeThreadId: string | null;
  targets: Targets;
  settle: SettleInputs;
  /** bb's default harness; null while unknown, when no root draws one. */
  defaultProviderId: string | null;
  /** bb's primary machine; null while unknown, when no row names its machine. */
  primaryHostId: string | null;
  /** Comfortable density: rows may take a branch line. */
  comfortable: boolean;
  /** A project's default branch: undefined while looked up, null when not found. */
  defaultBranchOf(thread: PluginSidebarThread): string | null | undefined;
  /**
   * The need-you filter is on: every group, hidden ones included, draws only
   * its trees that need attention, and a group with none is left out.
   */
  needYouOnly: boolean;
}

interface Context extends ViewInputs {
  compare: (a: SortKey, b: SortKey) => number;
  expandedChildren: ReadonlySet<string>;
  expandedOlder: ReadonlySet<string>;
  openSettledFolds: ReadonlySet<string>;
  collapsedEnvironments: ReadonlySet<string>;
  /** Parent ids on the path to a reveal target. */
  revealPath: ReadonlySet<string>;
  revealIds: ReadonlySet<string>;
  /** The open thread and its ancestors. */
  activePath: ReadonlySet<string>;
  projectNames: ReadonlyMap<string, string>;
  sectionNames: ReadonlyMap<string, string>;
}

function titleOf(context: Context, id: string | null): string | null {
  if (id === null) return null;
  return context.forest.infos.get(id)?.thread.displayTitle ?? null;
}

function crossGroupLabel(context: Context, info: ThreadInfo, root: ThreadInfo): string | null {
  const thread = info.thread;
  const rootThread = root.thread;
  if (info === root) return null;
  switch (context.prefs.organizationMode) {
    case "project":
      if (thread.projectId === rootThread.projectId) return null;
      return `In project ${context.projectNames.get(thread.projectId) ?? "another project"}`;
    case "chronological":
      if (thread.sectionId === rootThread.sectionId) return null;
      return thread.sectionId === null
        ? "In Threads"
        : `In section ${context.sectionNames.get(thread.sectionId) ?? "another section"}`;
    case "machine":
      if ((thread.host?.id ?? null) === (rootThread.host?.id ?? null)) return null;
      return thread.host === null ? "On no machine" : `On machine ${thread.host.name}`;
  }
}

/**
 * Whether a row's title steps back: a quiet thread does, at any depth, so
 * brightness shows state and depth is left to the indent and smaller text.
 * A root with children stays bright until its whole tree is quiet.
 */
function isDimmed(context: Context, info: ThreadInfo, chip: Chip | null): boolean {
  if (info.parentId === null && chip !== null) return context.forest.treeOf.get(info.thread.id)?.quiet ?? info.quiet;
  return info.quiet;
}


/** A root draws its harness when it differs from bb's default; a child, when it differs from its parent thread's. */
function drawsHarness(context: Context, info: ThreadInfo): boolean {
  const providerId = info.thread.providerId;
  if (info.parentId === null) return context.defaultProviderId !== null && providerId !== context.defaultProviderId;
  return providerId !== context.forest.infos.get(info.parentId)?.thread.providerId;
}

/** The row's second line and pull request badge, as the density and the branch allow. */
function lines(context: Context, info: ThreadInfo, depth: number): Pick<ThreadRow, "branchLine" | "pullRequest"> {
  const branch = info.thread.environment?.branchName ?? null;
  const offDefault = isOffDefaultBranch(branch, context.defaultBranchOf(info.thread));
  if (context.comfortable && info.note === null && offDefault) return { branchLine: branch, pullRequest: "second-line" };
  return { branchLine: null, pullRequest: depth === 0 && offDefault ? "title" : null };
}

/** The machine a row names: one other than bb's primary, unless the list is grouped by machine. */
function machineOf(context: Context, info: ThreadInfo): string | null {
  const host = info.thread.host;
  if (context.prefs.organizationMode === "machine" || context.primaryHostId === null || host === null) return null;
  return host.id === context.primaryHostId ? null : host.name || "Unknown machine";
}

function threadRow(
  context: Context,
  info: ThreadInfo,
  root: ThreadInfo,
  options: { depth: number; nested: boolean; chip: Chip | null },
): ThreadRow {
  return {
    ...lines(context, info, options.depth),
    machine: machineOf(context, info),
    type: "thread",
    key: `thread:${info.thread.id}`,
    info,
    depth: options.depth,
    nested: options.nested,
    parentTitle: titleOf(context, info.parentId),
    chip: options.chip,
    harness: drawsHarness(context, info),
    bold: info.unread,
    treeUnread: info === root && [root, ...(context.forest.treeOf.get(root.thread.id)?.descendants ?? [])].some((info) => info.unread),
    note: info.note,
    dimmed: isDimmed(context, info, options.chip),
    hiddenBadge: info.thread.isHidden,
    crossGroupLabel: crossGroupLabel(context, info, root),
    projectId: info.thread.projectId,
  };
}

/** The children of `parent` that get a row: hidden ones only when they need attention or failed. */
function eligibleChildren(context: Context, parentId: string): ThreadInfo[] {
  return (context.forest.children.get(parentId) ?? [])
    .map((id) => context.forest.infos.get(id)!)
    .filter((info) => !info.thread.isHidden || info.attentionFlags.size > 0);
}

function subtreeOf(context: Context, id: string): Subtree {
  return context.forest.subtrees.get(id)!;
}

/**
 * The children of one parent that show under its chip. Each level
 * folds on its own: its direct children only, and a child's own children wait
 * for that child's chip. A child never shows without its parent, because the
 * parent's level is the only place it is drawn.
 */
function foldedChildren(
  context: Context,
  parent: ThreadInfo,
  depth: number,
): { shown: ThreadInfo[]; older: OlderRow | null } {
  const parentId = parent.thread.id;
  const kids = eligibleChildren(context, parentId);

  const reveals = (kid: ThreadInfo) => context.revealIds.has(kid.thread.id) || context.revealPath.has(kid.thread.id);
  const olderRow = (scope: "tree" | "reveal", count: number, expanded: boolean): OlderRow | null =>
    count > 0
      ? {
          type: "older",
          key: `older:${scope}:${parentId}`,
          scopeId: parentId,
          scope,
          count,
          expanded,
          depth,
        }
      : null;

  if (!context.expandedChildren.has(parentId)) {
    const shown = kids.filter(reveals);
    // An auto-reveal says how much it left out.
    const left = kids.filter((kid) => !reveals(kid) && !kid.thread.isHidden).length;
    return { shown, older: shown.length > 0 ? olderRow("reveal", left, false) : null };
  }

  // The stable set reads `quietIgnoringOpen` for the child and everything under it, and
  // ignores which thread is open and the reveal targets: they join afterwards
  // and take no other row's place.
  const quietTree = (kid: ThreadInfo) => kid.quietIgnoringOpen && subtreeOf(context, kid.thread.id).quietIgnoringOpen;
  const stable = new Set<string>();
  for (const kid of kids) if (kid.thread.isHidden || !quietTree(kid)) stable.add(kid.thread.id);
  const recentQuiet = kids
    .filter((kid) => !stable.has(kid.thread.id) && !kid.thread.isHidden)
    .sort((a, b) => b.thread.createdAt - a.thread.createdAt)
    .slice(0, KEEP_QUIET_CHILDREN);
  for (const kid of recentQuiet) stable.add(kid.thread.id);
  const olderExpanded = context.expandedOlder.has(parentId);
  const kept = (kid: ThreadInfo) =>
    stable.has(kid.thread.id) || reveals(kid) || context.activePath.has(kid.thread.id);
  // Open, the fold still counts what it holds, so its row can close it again.
  const folded = kids.filter((kid) => !kept(kid)).length;
  const shown = olderExpanded ? kids : kids.filter(kept);
  return { shown, older: olderRow("tree", folded, olderExpanded) };
}

function environmentLabel(thread: PluginSidebarThread): string {
  const environment = thread.environment;
  if (environment === null) return "Environment";
  if (environment.name) return environment.name;
  if (environment.branchName) return environment.branchName;
  if (environment.path) return environment.path.split(/[\\/]/).filter(Boolean).pop() ?? "Environment";
  return "Environment";
}

type Unit = { info: ThreadInfo; rows: TreeRow[]; flags: ReadonlySet<Flag> };

/**
 * Folds sibling units that share a worktree environment (2 or more) into a
 * folder row. Off unless the environment grouping preference is on.
 */
function clusterEnvironments(context: Context, units: Unit[], depth: number): TreeRow[] {
  if (!context.prefs.environmentGrouping) return units.flatMap((unit) => unit.rows);
  const counts = new Map<string, number>();
  for (const unit of units) {
    const environment = unit.info.thread.environment;
    if (environment?.isWorktree === true && environment.id !== null) {
      counts.set(environment.id, (counts.get(environment.id) ?? 0) + 1);
    }
  }
  const rows: TreeRow[] = [];
  const emitted = new Set<string>();
  for (const unit of units) {
    const environment = unit.info.thread.environment;
    const id = environment?.isWorktree === true ? environment.id : null;
    if (id === null || (counts.get(id) ?? 0) < 2) {
      rows.push(...unit.rows);
      continue;
    }
    if (emitted.has(id)) continue;
    emitted.add(id);
    const members = units.filter((candidate) => candidate.info.thread.environment?.id === id);
    const collapsed = context.collapsedEnvironments.has(id);
    const flags = new Set<Flag>();
    for (const member of members) for (const flag of member.flags) flags.add(flag);
    rows.push({
      type: "environment",
      key: `environment:${id}:${unit.info.thread.id}`,
      environmentId: id,
      label: environmentLabel(unit.info.thread),
      environmentProviderId: environment?.providerId ?? null,
      projectId: unit.info.thread.projectId,
      sectionId: unit.info.thread.sectionId,
      threadIds: members.map((member) => member.info.thread.id),
      collapsed,
      flag: collapsed ? mostUrgent(flags) : null,
      depth,
    });
    if (!collapsed) {
      for (const member of members) {
        for (const row of member.rows) rows.push({ ...row, depth: row.depth + 1 });
      }
    }
  }
  return rows;
}

/** The children chip of a parent, or null when it would show nothing. */
function chipOf(context: Context, info: ThreadInfo, expanded: boolean): Chip | null {
  const { childCount: count, chipFlags } = subtreeOf(context, info.thread.id);
  const flag = mostUrgent(chipFlags);
  // A hidden child's failure that needs no attention has no row, yet the chip still shows it.
  if (count === 0 && flag === null && eligibleChildren(context, info.thread.id).length === 0) return null;
  return { count, expanded, flag };
}

/** What a thread and everything under it carry, for an environment folder's glyph. */
function rollupFlags(context: Context, info: ThreadInfo): Set<Flag> {
  const flags = new Set<Flag>([...info.attentionFlags, ...subtreeOf(context, info.thread.id).flags]);
  if (info.flags.has("working")) flags.add("working");
  return flags;
}

/** The rows under `parent`: each shown child, then its own level. */
function foldedLevel(context: Context, tree: ThreadTree, parent: ThreadInfo, depth: number): TreeRow[] {
  const { shown, older } = foldedChildren(context, parent, depth);
  const units: Unit[] = shown.map((info) => ({
    info,
    flags: rollupFlags(context, info),
    rows: [
      threadRow(context, info, tree.root, {
        depth,
        nested: depth > 1,
        // Expanded only when the user expanded it: an auto-reveal shows a
        // chevron that still expands, and a "N more child threads" row.
        chip: chipOf(context, info, context.expandedChildren.has(info.thread.id)),
      }),
      ...foldedLevel(context, tree, info, depth + 1),
    ],
  }));
  const rows = clusterEnvironments(context, units, depth);
  if (older !== null) rows.push(older);
  return rows;
}

function foldedTreeRows(context: Context, tree: ThreadTree): TreeRow[] {
  const root = tree.root;
  const chip = chipOf(context, root, context.expandedChildren.has(root.thread.id));
  return [threadRow(context, root, root, { depth: 0, nested: false, chip }), ...foldedLevel(context, tree, root, 1)];
}

function treeUnit(context: Context, tree: ThreadTree): Unit {
  return { info: tree.root, rows: foldedTreeRows(context, tree), flags: tree.flags };
}

/** Whether a thread in the tree needs attention: it stays drawn when its group is collapsed. */
export function needsAttention(tree: Pick<ThreadTree, "attentionFlags">): boolean {
  return tree.attentionFlags.size > 0;
}

/** The need-you filter's N: thread trees that need attention, in every group. */
export function countNeedYou(forest: Pick<Forest, "trees">): number {
  return forest.trees.filter(needsAttention).length;
}

/** The filter narrows the list only while something needs you: at 0 the full list is back. */
export function needYouActive(on: boolean, count: number): boolean {
  return on && count > 0;
}

/**
 * One group. `trees` is every tree bucketed in it. Collapsed, it draws only
 * its trees that need attention; opening a thread in it opens it, as an
 * auto-reveal did.
 */
function buildGroup(context: Context, descriptor: GroupDescriptor, trees: ThreadTree[], hidden: boolean): GroupView {
  if (context.needYouOnly) return needYouGroup(context, descriptor, trees, hidden);
  const counters = countTrees(trees);
  const userCollapsed = isGroupCollapsed(descriptor, context.prefs);
  const activeId = context.activeThreadId;
  const opened =
    activeId !== null && context.targets.has(activeId) && trees.some((tree) => tree.containsActive);
  const collapsed = userCollapsed && !opened;
  const isPinned = descriptor.id === PINNED_GROUP_ID;

  const sorted = sortTrees(context, descriptor, trees);

  let rows: Row[];
  if (collapsed) {
    rows = clusterEnvironments(context, sorted.filter(needsAttention).map((tree) => treeUnit(context, tree)), 0);
  } else {
    // Settled trees go behind the fold at the group's end. The open one, if
    // settled, is drawn just above the divider, so opening it moves nothing else.
    const settled = sorted.filter((tree) => isSettledTree(tree, context.settle));
    const settledSet = new Set(settled);
    const live = sorted.filter((tree) => !settledSet.has(tree));
    const open = settled.find((tree) => tree.containsActive) ?? null;
    rows = clusterEnvironments(context, live.map((tree) => treeUnit(context, tree)), 0);
    if (settled.length > 0) {
      if (open !== null) rows.push(...treeUnit(context, open).rows);
      const expanded = context.openSettledFolds.has(descriptor.id);
      rows.push({ type: "settled", key: `settled:${descriptor.id}`, groupId: descriptor.id, count: settled.length, expanded });
      if (expanded) {
        const folded = settled.filter((tree) => tree !== open).map((tree) => treeUnit(context, tree));
        rows.push(...clusterEnvironments(context, folded, 0));
      }
    }
  }
  return {
    descriptor,
    counters,
    userCollapsed,
    collapsed,
    hidden,
    rows,
    rootIds: trees.map((tree) => tree.root.thread.id),
  };
}

/** A group's trees in its order: Pinned's own, else the chosen sort. */
function sortTrees(context: Context, descriptor: GroupDescriptor, trees: readonly ThreadTree[]): ThreadTree[] {
  if (descriptor.id === PINNED_GROUP_ID) return [...trees].sort((a, b) => comparePinned(a.root.thread, b.root.thread));
  return [...trees].sort((a, b) =>
    context.compare(
      { thread: a.root.thread, treeAttention: a.latestAttentionAt },
      { thread: b.root.thread, treeAttention: b.latestAttentionAt },
    ),
  );
}

/** A group under the need-you filter: its header, and its trees that need attention, whatever its collapse. */
function needYouGroup(context: Context, descriptor: GroupDescriptor, trees: ThreadTree[], hidden: boolean): GroupView {
  const sorted = sortTrees(context, descriptor, trees);
  return {
    descriptor,
    counters: countTrees(trees),
    userCollapsed: isGroupCollapsed(descriptor, context.prefs),
    collapsed: false,
    hidden,
    rows: clusterEnvironments(context, sorted.filter(needsAttention).map((tree) => treeUnit(context, tree)), 0),
    rootIds: trees.map((tree) => tree.root.thread.id),
  };
}

export function buildListView(inputs: ViewInputs): ListView {
  const { forest, prefs } = inputs;
  const revealIds = new Set<string>();
  const revealPath = new Set<string>();
  for (const [id, kind] of inputs.targets) {
    if (kind !== "reveal" || !forest.infos.has(id)) continue;
    revealIds.add(id);
    for (const ancestor of ancestorsOf(id, forest.infos)) revealPath.add(ancestor);
  }
  const activePath = new Set<string>();
  if (inputs.activeThreadId !== null && forest.infos.has(inputs.activeThreadId)) {
    activePath.add(inputs.activeThreadId);
    for (const ancestor of ancestorsOf(inputs.activeThreadId, forest.infos)) activePath.add(ancestor);
  }
  const context: Context = {
    ...inputs,
    compare: makeComparator({ field: prefs.chronologicalSort, direction: prefs.sortDirection }),
    expandedChildren: new Set(prefs.expandedChildren),
    expandedOlder: new Set(prefs.expandedOlder),
    openSettledFolds: new Set(prefs.openSettledFolds),
    collapsedEnvironments: new Set(prefs.collapsedEnvironments),
    revealIds,
    revealPath,
    activePath,
    projectNames: new Map(inputs.projects.map((project) => [project.id, project.name])),
    sectionNames: new Map(inputs.sections.map((section) => [section.id, section.name])),
  };

  const byGroup = new Map<string, ThreadTree[]>();
  for (const tree of forest.trees) {
    const id = groupIdForRoot(tree.root.thread, {
      mode: prefs.organizationMode,
      projects: inputs.projects,
    });
    const list = byGroup.get(id) ?? [];
    list.push(tree);
    byGroup.set(id, list);
  }

  const alphabetical = effectiveSortField(prefs.chronologicalSort) === "alpha";
  const entities = entityGroups(
    { mode: prefs.organizationMode, projects: inputs.projects, sections: inputs.sections, threads: inputs.threads },
    alphabetical,
  );
  const descriptors = new Map<string, GroupDescriptor>(entities.map((group) => [group.id, group]));
  descriptors.set(PINNED_GROUP_ID, builtinGroup(PINNED_GROUP_ID, inputs.projects));
  descriptors.set(THREADS_GROUP_ID, builtinGroup(THREADS_GROUP_ID, inputs.projects));
  const order = resolveGroupOrder(
    prefs.organizationMode,
    prefs[ORDER_PREFERENCE[prefs.organizationMode]],
    entities.map((group) => group.id),
  );
  const hiddenIds = new Set(prefs.hiddenGroups);

  const groups: GroupView[] = [];
  const more: GroupView[] = [];
  let moreCounters = EMPTY_COUNTERS;
  for (const id of order) {
    const descriptor = descriptors.get(id);
    if (descriptor === undefined) continue;
    const trees = byGroup.get(id) ?? [];
    // Pinned and the loose bucket appear only when they hold threads, except
    // the loose bucket in custom-section mode, as in bb.
    if (trees.length === 0) {
      if (id === PINNED_GROUP_ID) continue;
      if (id === THREADS_GROUP_ID && prefs.organizationMode !== "chronological") continue;
    }
    const hidden = id !== PINNED_GROUP_ID && hiddenIds.has(id);
    if (context.needYouOnly) {
      // Under the filter, a hidden group's trees come out of More, each under its own header.
      if (trees.some(needsAttention)) groups.push(buildGroup(context, descriptor, trees, hidden));
      continue;
    }
    const view = buildGroup(context, descriptor, trees, hidden);
    if (hidden) {
      more.push(view);
      moreCounters = addCounters(moreCounters, view.counters);
    } else {
      groups.push(view);
    }
  }

  return { groups, more, moreCounters, order, needYouCount: countNeedYou(forest) };
}

/** Every thread row in visual order, for keyboard and windowing. */
export function threadRowsOf(rows: readonly Row[]): ThreadRow[] {
  return rows.filter((row): row is ThreadRow => row.type === "thread");
}
