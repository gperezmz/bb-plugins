// Accessible names: everything a tooltip says is in the aria-label.
import type { Chip, OlderRow, SettledRow, ThreadRow } from "./view";
import { treeState } from "./state";
import { formatDateTime } from "./details";
import type { OrganizationMode } from "@/shared/preferences";

/**
 * The row's state: its own, or a state from inside its tree and then its own,
 * "Working, in child threads; unread". A plugin row status's label replaces
 * whichever the glyph would show.
 */
export function stateText(row: ThreadRow, pluginLabel: string | null): string {
  const state = row.info.state;
  let own = pluginLabel ?? state.label;
  if (state.kind === "scheduled" && state.sendAt !== null) {
    own = `${own}, sends ${formatDateTime(state.sendAt)}`;
  }
  if (pluginLabel !== null || row.treeFlag === null) return own;
  return `${treeState(row.treeFlag).label}, in child threads; ${own.charAt(0).toLowerCase()}${own.slice(1)}`;
}

/** "Open Fix login — Working; Claude Code; child of Release; unread". */
export function rowAriaLabel(
  row: ThreadRow,
  options: { providerName: string; pluginLabel: string | null; hasDraft: boolean },
): string {
  const parts = [stateText(row, options.pluginLabel), options.providerName];
  if (row.parentTitle !== null && row.depth > 0) parts.push(`child of ${row.parentTitle}`);
  if (row.crossGroupLabel !== null) parts.push(row.crossGroupLabel.toLowerCase());
  if (row.hiddenBadge) parts.push("hidden thread");
  if (row.info.unread && row.info.state.kind !== "unread") parts.push("unread");
  if (options.hasDraft && row.info.state.kind !== "draft") parts.push("unsubmitted draft");
  return `Open ${row.info.thread.displayTitle} — ${parts.join("; ")}`;
}

/** "Show 2 child threads of Release, 1 unread in the tree". */
export function chipLabel(title: string, chip: Chip): string {
  const noun = chip.count === 1 ? "child thread" : "child threads";
  const unread = chip.unread > 0 ? `, ${chip.unread} unread in the tree` : "";
  return `${chip.expanded ? "Collapse" : "Show"} ${chip.count} ${noun} of ${title}${unread}`;
}

/** The text and accessible name of an open tree's fold row. */
export function olderRowText(row: OlderRow): { label: string; ariaLabel: string } {
  const children = row.count === 1 ? "child thread" : "child threads";
  if (row.expanded) return { label: "Show fewer", ariaLabel: `Hide ${row.count} more ${children}` };
  return { label: `${row.count} more ${children}`, ariaLabel: `Show ${row.count} more ${children}` };
}

/** The settled fold's text: "Settled (N)" while closed, "Settled" while open. N counts trees. */
export function settledRowText(row: SettledRow): { label: string; ariaLabel: string } {
  const noun = row.count === 1 ? "settled thread tree" : "settled thread trees";
  return {
    label: row.expanded ? "Settled" : `Settled (${row.count})`,
    ariaLabel: `${row.expanded ? "Hide" : "Show"} ${row.count} ${noun}`,
  };
}

/** The list header's name for the current grouping. */
export function groupingName(mode: OrganizationMode): string {
  switch (mode) {
    case "project":
      return "Projects";
    case "chronological":
      return "Sections";
    case "machine":
      return "Machines";
  }
}
