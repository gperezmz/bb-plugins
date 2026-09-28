// Accessible names: everything a tooltip says is in the aria-label.
import type { OlderRow, SettledRow, ThreadRow } from "./view";
import { FLAG_GLYPHS, type Flag } from "./state";
import { formatDateTime } from "./details";
import type { OrganizationMode } from "@/shared/preferences";

export function stateText(row: ThreadRow, pluginLabel: string | null): string {
  const state = row.info.state;
  const base = pluginLabel ?? state.label;
  if (state.kind === "scheduled" && state.sendAt !== null) {
    return `${base}, sends ${formatDateTime(state.sendAt)}`;
  }
  return base;
}

/** "Open Fix login — Working; Claude Code; child of Release; unread". */
export function rowAriaLabel(
  row: ThreadRow,
  options: { providerName: string; pluginLabel: string | null; hasDraft: boolean },
): string {
  const parts = [stateText(row, options.pluginLabel), options.providerName];
  if (row.parentTitle !== null && row.depth > 0) parts.push(`child of ${row.parentTitle}`);
  if (row.childDot !== null) parts.push(`child threads: ${FLAG_GLYPHS[row.childDot].label}`);
  if (row.crossGroupLabel !== null) parts.push(row.crossGroupLabel.toLowerCase());
  if (row.hiddenBadge) parts.push("hidden thread");
  if (row.info.unread && row.info.state.kind !== "unread") parts.push("unread");
  if (options.hasDraft && row.info.state.kind !== "draft") parts.push("unsubmitted draft");
  return `Open ${row.info.thread.displayTitle} — ${parts.join("; ")}`;
}

export function chipLabel(title: string, count: number, expanded: boolean): string {
  const noun = count === 1 ? "child thread" : "child threads";
  return `${expanded ? "Collapse" : "Show"} ${count} ${noun} of ${title}`;
}

/** The text and accessible name of an open tree's fold row. */
export function olderRowText(row: OlderRow): { label: string; ariaLabel: string } {
  const children = row.count === 1 ? "child thread" : "child threads";
  if (row.expanded) return { label: "Show fewer", ariaLabel: `Hide ${row.count} older ${children}` };
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
