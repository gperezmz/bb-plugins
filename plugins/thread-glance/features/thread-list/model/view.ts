// The list view: groups, their counters and the flat rows
// each one renders. Components draw this; they decide nothing. Pure.
import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { Preferences } from "@/shared/preferences";
import { ancestorsOf, type Family, type Forest, type Subtree, type ThreadInfo } from "./families";
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
import { addCounters, countFamilies, EMPTY_COUNTERS, type Counters } from "./counters";
import { comparePinned, effectiveSortField, makeComparator, type SortKey } from "./sort";
import { inAttention } from "./attention";
import { mostUrgent, type Flag } from "./state";
import type { Targets } from "./expansion";
import type { RowNote } from "./notes";

/** How many of a group's newest quiet roots stay out of its older fold. */
export const KEEP_QUIET = 5;
/** How many quiet children stay in an expanded family. */
export const KEEP_QUIET_CHILDREN = 3;

export interface Chip {
  count: number;
  flag: Flag | null;
  /** The user opened the chip, so every child shows. */
  expanded: boolean;
  /** Harnesses among the visible children that differ from the parent's. */
  providerIds: string[];
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
   * The line under the title. In Needs attention, a row that itself needs
   * attention says why; any other row says why it waits on you or failed.
   */
  note: RowNote | null;
  /** The title, and the chip with it, step back: see `isDimmed`. */
  dimmed: boolean;
  /** A hidden thread shown because it needs attention or failed. */
  hiddenBadge: boolean;
  /** "In project X" when the thread is outside its family's group. */
  crossGroupLabel: string | null;
  /** A root in Needs attention: its home group's name, drawn where the age goes. */
  homeGroupLabel: string | null;
  projectId: string;
}

export interface OlderRow {
  type: "older";
  key: string;
  /** A group id, or a parent thread id for a family's fold. */
  scopeId: string;
  /** `reveal`: an auto-reveal left `count` children hidden ("+N more"). */
  scope: "group" | "family" | "reveal";
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

/** Under a closed family in Needs attention: how many of its child threads it leaves out ("+N more"). Opens the family. */
export interface LeftOutRow {
  type: "left-out";
  key: string;
  /** The family's root. */
  scopeId: string;
  count: number;
  depth: number;
}

export type Row = ThreadRow | OlderRow | EnvironmentRow | LeftOutRow;

export interface GroupView {
  descriptor: GroupDescriptor;
  counters: Counters;
  /** What the user stored. */
  userCollapsed: boolean;
  /** What is drawn: user collapse, unless a target opened it. */
  collapsed: boolean;
  hidden: boolean;
  rows: Row[];
  /** Every family root bucketed in the group, those in Needs attention and behind folds included. */
  rootIds: string[];
}

/** The id Needs attention's rows are drawn under; no group has it. */
export const ATTENTION_GROUP_ID = "attention";

/** The Needs attention section: every family with a thread that needs attention, or held there while one of its threads is open. */
export interface AttentionView {
  /** How many families the section holds, for its header. */
  familyCount: number;
  rows: Row[];
  /** The home group of each thread drawn here, by thread id: a drop on its row acts there. */
  homeGroupIds: Record<string, string>;
}

export interface ListView {
  /** Null when no family is in the section. */
  attention: AttentionView | null;
  groups: GroupView[];
  /** Hidden groups, shown in the More popover. */
  more: GroupView[];
  moreCounters: Counters;
  /** Resolved top-level order for the mode, for header drag. */
  order: string[];
  /** Threads span more than one host (the row's second line). */
  multiHost: boolean;
}

export interface ViewInputs {
  forest: Forest;
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  sections: readonly PluginSidebarSection[];
  prefs: Preferences;
  activeThreadId: string | null;
  /** The root of the family Needs attention keeps while one of its threads is open. */
  heldRootId: string | null;
  targets: Targets;
}

interface Context extends ViewInputs {
  compare: (a: SortKey, b: SortKey) => number;
  expandedChildren: ReadonlySet<string>;
  expandedOlder: ReadonlySet<string>;
  collapsedEnvironments: ReadonlySet<string>;
  /** Parent ids on the path to a reveal target. */
  revealPath: ReadonlySet<string>;
  revealIds: ReadonlySet<string>;
  /** The open thread and its ancestors. */
  activePath: ReadonlySet<string>;
  projectNames: ReadonlyMap<string, string>;
  sectionNames: ReadonlyMap<string, string>;
  /** The rows are drawn in Needs attention. */
  drawnInAttention: boolean;
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
 * A root with children stays bright until its whole family is quiet.
 */
function isDimmed(context: Context, info: ThreadInfo, chip: Chip | null): boolean {
  if (info.parentId === null && chip !== null) return context.forest.familyOf.get(info.thread.id)?.quiet ?? info.quiet;
  return info.quiet;
}

function threadRow(
  context: Context,
  info: ThreadInfo,
  root: ThreadInfo,
  options: { depth: number; nested: boolean; chip: Chip | null },
): ThreadRow {
  const needsAttention = !info.thread.isArchived && info.attentionFlags.size > 0;
  return {
    type: "thread",
    key: `thread:${info.thread.id}`,
    info,
    depth: options.depth,
    nested: options.nested,
    parentTitle: titleOf(context, info.parentId),
    chip: options.chip,
    note: context.drawnInAttention && needsAttention ? info.attentionNote : info.note,
    dimmed: isDimmed(context, info, options.chip),
    hiddenBadge: info.thread.isHidden,
    crossGroupLabel: crossGroupLabel(context, info, root),
    homeGroupLabel: null,
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
  const olderRow = (scope: "family" | "reveal", count: number, expanded: boolean): OlderRow | null =>
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
  return { shown, older: olderRow("family", folded, olderExpanded) };
}

function environmentLabel(thread: PluginSidebarThread): string {
  const environment = thread.environment;
  if (environment === null) return "Environment";
  if (environment.name) return environment.name;
  if (environment.branchName) return environment.branchName;
  if (environment.path) return environment.path.split(/[\\/]/).filter(Boolean).pop() ?? "Environment";
  return "Environment";
}

type Unit = { info: ThreadInfo; rows: Row[]; flags: ReadonlySet<Flag> };

/**
 * Folds sibling units that share a worktree environment (2 or more) into a
 * folder row. Off unless the environment grouping preference is on.
 */
function clusterEnvironments(context: Context, units: Unit[], depth: number): Row[] {
  if (!context.prefs.environmentGrouping) return units.flatMap((unit) => unit.rows);
  const counts = new Map<string, number>();
  for (const unit of units) {
    const environment = unit.info.thread.environment;
    if (environment?.isWorktree === true && environment.id !== null) {
      counts.set(environment.id, (counts.get(environment.id) ?? 0) + 1);
    }
  }
  const rows: Row[] = [];
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

/** Distinct child harnesses other than the parent's, at most three. */
function childProviders(parent: ThreadInfo, descendants: readonly ThreadInfo[]): string[] {
  const ids: string[] = [];
  for (const info of descendants) {
    const id = info.thread.providerId;
    if (info.thread.isHidden || id === parent.thread.providerId || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === 3) break;
  }
  return ids;
}

/** The chip of a parent: its children's count, most urgent flag and harnesses. */
function chipOf(context: Context, info: ThreadInfo, expanded: boolean): Chip | null {
  const subtree = subtreeOf(context, info.thread.id);
  const hasChildren =
    subtree.visibleCount > 0 || subtree.descendants.some((descendant) => descendant.thread.isHidden && descendant.attentionFlags.size > 0);
  if (!hasChildren) return null;
  return {
    count: subtree.visibleCount,
    flag: mostUrgent(subtree.flags),
    expanded,
    providerIds: childProviders(info, subtree.descendants),
  };
}

/** What a thread and everything under it carry, for an environment folder's glyph. */
function rollupFlags(context: Context, info: ThreadInfo): Set<Flag> {
  const flags = new Set<Flag>([...info.attentionFlags, ...subtreeOf(context, info.thread.id).flags]);
  if (info.flags.has("working")) flags.add("working");
  return flags;
}

/** The rows under `parent`: each shown child, then its own level. */
function foldedLevel(context: Context, family: Family, parent: ThreadInfo, depth: number): Row[] {
  const { shown, older } = foldedChildren(context, parent, depth);
  const units: Unit[] = shown.map((info) => ({
    info,
    flags: rollupFlags(context, info),
    rows: [
      threadRow(context, info, family.root, {
        depth,
        nested: depth > 1,
        // Expanded only when the user expanded it: an auto-reveal shows a
        // chevron that still expands, and a "N more child threads" row.
        chip: chipOf(context, info, context.expandedChildren.has(info.thread.id)),
      }),
      ...foldedLevel(context, family, info, depth + 1),
    ],
  }));
  const rows = clusterEnvironments(context, units, depth);
  if (older !== null) rows.push(older);
  return rows;
}

function foldedFamilyRows(context: Context, family: Family): Row[] {
  const root = family.root;
  const chip = chipOf(context, root, context.expandedChildren.has(root.thread.id));
  return [threadRow(context, root, root, { depth: 0, nested: false, chip }), ...foldedLevel(context, family, root, 1)];
}

function familyUnit(context: Context, family: Family): Unit {
  return { info: family.root, rows: foldedFamilyRows(context, family), flags: family.flags };
}

/** Waiting on you, then failed, then offline, then unread, then the rest. */
export function urgency(family: Family): number {
  const flags = family.attentionFlags;
  if (flags.has("waits-on-you")) return 0;
  if (flags.has("unread-failed") || flags.has("queue-failed")) return 1;
  if (flags.has("offline")) return 2;
  if (flags.has("unread")) return 3;
  return 4;
}

/**
 * One family's rows in Needs attention. It arrives with the path from the root
 * down to each thread that needs attention or is open. Closed, the path is all
 * it draws, with one "+N more" line for the child threads left out; opened
 * with the root's chip, it draws as in its home group and keeps the path.
 */
function attentionFamilyRows(groupContext: Context, family: Family, homeGroupLabel: string): Row[] {
  const context: Context = { ...groupContext, drawnInAttention: true };
  const root = family.root;
  const onPath = new Set<string>([root.thread.id]);
  for (const info of family.descendants) {
    const attention = !info.thread.isArchived && info.attentionFlags.size > 0;
    if (!attention && !info.isActive) continue;
    onPath.add(info.thread.id);
    for (const ancestor of ancestorsOf(info.thread.id, context.forest.infos, root.thread.id)) onPath.add(ancestor);
  }
  const expanded = context.expandedChildren.has(root.thread.id);
  if (expanded) {
    // The path is kept the way a reveal target's is.
    const kept: Context = { ...context, revealIds: new Set([...context.revealIds, ...onPath]) };
    const [rootRow, ...rest] = foldedFamilyRows(kept, family);
    return [{ ...(rootRow as ThreadRow), homeGroupLabel }, ...rest];
  }
  const chip = chipOf(context, root, false);
  const rows: Row[] = [{ ...threadRow(context, root, root, { depth: 0, nested: false, chip }), homeGroupLabel }];
  const walk = (parentId: string, depth: number) => {
    for (const id of context.forest.children.get(parentId) ?? []) {
      if (!onPath.has(id)) continue;
      rows.push(threadRow(context, context.forest.infos.get(id)!, root, { depth, nested: depth > 1, chip: null }));
      walk(id, depth + 1);
    }
  };
  walk(root.thread.id, 1);
  const left = family.descendants.filter((info) => !info.thread.isHidden && !onPath.has(info.thread.id)).length;
  if (left > 0) rows.push({ type: "left-out", key: `left-out:${root.thread.id}`, scopeId: root.thread.id, count: left, depth: 1 });
  return rows;
}

function buildAttention(
  context: Context,
  families: readonly Family[],
  homeGroupOf: (family: Family) => GroupDescriptor,
): AttentionView | null {
  if (families.length === 0) return null;
  // Most urgent first, then the chosen field in its natural direction: the
  // sort direction orders the groups only.
  const compare = makeComparator({
    field: context.prefs.chronologicalSort,
    direction: "default",
    workingFirst: context.prefs.workingFirst,
  });
  const sorted = [...families].sort(
    (a, b) =>
      urgency(a) - urgency(b) ||
      compare(
        { thread: a.root.thread, familyAttention: a.latestAttentionAt },
        { thread: b.root.thread, familyAttention: b.latestAttentionAt },
      ),
  );
  const homeGroupIds: Record<string, string> = {};
  const rows = sorted.flatMap((family) => {
    const home = homeGroupOf(family);
    const familyRows = attentionFamilyRows(context, family, home.label);
    for (const row of familyRows) if (row.type === "thread") homeGroupIds[row.info.thread.id] = home.id;
    return familyRows;
  });
  return {
    familyCount: sorted.length,
    rows,
    homeGroupIds,
  };
}

/**
 * One group. `families` is every family bucketed in it, for its counters and
 * `rootIds`; `drawn` leaves out those in Needs attention.
 */
function buildGroup(
  context: Context,
  descriptor: GroupDescriptor,
  families: Family[],
  drawn: Family[],
  hidden: boolean,
): GroupView {
  const counters = countFamilies(families);
  const userCollapsed = isGroupCollapsed(descriptor, context.prefs);
  const hasTarget = drawn.some(
    (family) =>
      context.targets.has(family.root.thread.id) ||
      family.descendants.some((info) => context.targets.has(info.thread.id)),
  );
  const collapsed = userCollapsed && !hasTarget;
  const isPinned = descriptor.id === PINNED_GROUP_ID;

  const sorted = [...drawn];
  if (isPinned) {
    sorted.sort((a, b) => comparePinned(a.root.thread, b.root.thread));
  } else {
    sorted.sort((a, b) =>
      context.compare(
        { thread: a.root.thread, familyAttention: a.latestAttentionAt },
        { thread: b.root.thread, familyAttention: b.latestAttentionAt },
      ),
    );
  }

  let visible = sorted;
  let older: OlderRow | null = null;
  const foldable = !isPinned && context.prefs.foldOlder;
  if (foldable) {
    // The fold reads `quietIgnoringOpen`, as if no thread were open. The open family
    // joins afterwards when it sits behind the fold, and takes no other row's place.
    const quietActive = sorted.filter((family) => family.quietIgnoringOpen && !family.root.thread.isArchived);
    // The newest quiet roots stay whatever the order: by creation under
    // Created, by latest activity otherwise.
    const byCreation = effectiveSortField(context.prefs.chronologicalSort) === "created";
    const age = (family: Family) => (byCreation ? family.root.thread.createdAt : family.latestAttentionAt);
    const keepQuiet = new Set([...quietActive].sort((a, b) => age(b) - age(a)).slice(0, KEEP_QUIET));
    const foldedFamilies = quietActive.filter((family) => !keepQuiet.has(family) && !family.containsActive);
    if (foldedFamilies.length > 0) {
      const opened =
        context.expandedOlder.has(descriptor.id) ||
        foldedFamilies.some(
          (family) =>
            context.targets.has(family.root.thread.id) ||
            family.descendants.some((info) => context.targets.has(info.thread.id)),
        );
      const folded = new Set(foldedFamilies);
      if (!opened) visible = sorted.filter((family) => !folded.has(family));
      older = {
        type: "older",
        key: `older:group:${descriptor.id}`,
        scopeId: descriptor.id,
        scope: "group",
        count: foldedFamilies.length,
        expanded: opened,
        depth: 0,
      };
    }
  }

  const units = visible.map((family) => familyUnit(context, family));
  const rows = clusterEnvironments(context, units, 0);
  if (older !== null) rows.push(older);
  return {
    descriptor,
    counters,
    userCollapsed,
    collapsed,
    hidden,
    rows,
    rootIds: families.map((family) => family.root.thread.id),
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
    compare: makeComparator({
      field: prefs.chronologicalSort,
      direction: prefs.sortDirection,
      workingFirst: prefs.workingFirst,
    }),
    expandedChildren: new Set(prefs.expandedChildren),
    expandedOlder: new Set(prefs.expandedOlder),
    collapsedEnvironments: new Set(prefs.collapsedEnvironments),
    revealIds,
    revealPath,
    activePath,
    projectNames: new Map(inputs.projects.map((project) => [project.id, project.name])),
    sectionNames: new Map(inputs.sections.map((section) => [section.id, section.name])),
    drawnInAttention: false,
  };

  const byGroup = new Map<string, Family[]>();
  const homeOf = new Map<Family, string>();
  const section: Family[] = [];
  const openRootId = inputs.activeThreadId === null ? null : (forest.familyOf.get(inputs.activeThreadId)?.root.thread.id ?? null);
  for (const family of forest.families) {
    const id = groupIdForRoot(family.root.thread, {
      mode: prefs.organizationMode,
      projects: inputs.projects,
    });
    const list = byGroup.get(id) ?? [];
    list.push(family);
    byGroup.set(id, list);
    homeOf.set(family, id);
    if (inAttention(family, inputs.heldRootId, openRootId)) section.push(family);
  }
  const inSection = new Set(section);

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
    const families = byGroup.get(id) ?? [];
    const drawn = families.filter((family) => !inSection.has(family));
    // Pinned and the loose bucket appear only when they hold threads outside
    // Needs attention, except the loose bucket in custom-section mode, as in bb.
    if (drawn.length === 0) {
      if (id === PINNED_GROUP_ID) continue;
      if (id === THREADS_GROUP_ID && prefs.organizationMode !== "chronological") continue;
    }
    const hidden = id !== PINNED_GROUP_ID && hiddenIds.has(id);
    const view = buildGroup(context, descriptor, families, drawn, hidden);
    if (hidden) {
      more.push(view);
      moreCounters = addCounters(moreCounters, view.counters);
    } else {
      groups.push(view);
    }
  }

  const hosts = new Set<string>();
  for (const thread of inputs.threads) if (thread.host !== null) hosts.add(thread.host.id);
  // Every root's group id has a descriptor: entity groups include unknown sections and every host.
  const attention = buildAttention(context, section, (family) => descriptors.get(homeOf.get(family)!)!);
  return { attention, groups, more, moreCounters, order, multiHost: hosts.size > 1 };
}

/** Every thread row in visual order, for keyboard and windowing. */
export function threadRowsOf(rows: readonly Row[]): ThreadRow[] {
  return rows.filter((row): row is ThreadRow => row.type === "thread");
}
