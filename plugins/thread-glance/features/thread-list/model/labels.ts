// Accessible names: everything a tooltip says is in the aria-label.
import type { Chip, OlderRow, SettledRow, ThreadRow } from "./view";
import type { Flag } from "./state";
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
  if (row.crossGroupLabel !== null) parts.push(row.crossGroupLabel.toLowerCase());
  if (row.hiddenBadge) parts.push("hidden thread");
  if (row.info.unread && row.info.state.kind !== "unread") parts.push("unread");
  if (options.hasDraft && row.info.state.kind !== "draft") parts.push("unsubmitted draft");
  return `Open ${row.info.thread.displayTitle} — ${parts.join("; ")}`;
}

/** What a children chip's state says, uncounted: the state can come from any depth, the count only from direct children. */
const CHIP_STATE_TEXT: Readonly<Record<Flag, string>> = {
  "waits-on-you": "waiting on you below",
  "unread-failed": "failed below",
  "queue-failed": "queued message failed below",
  offline: "machine offline below",
  working: "working below",
  unread: "unread below",
};

/**
 * "Show 2 child threads of Release, working below"; with no visible child,
 * "Show hidden child threads of Release, waiting on you below".
 */
export function chipLabel(title: string, chip: Chip): string {
  const children = chip.count === 0 ? "hidden child threads" : `${chip.count} ${chip.count === 1 ? "child thread" : "child threads"}`;
  const state = chip.flag === null ? "" : `, ${CHIP_STATE_TEXT[chip.flag]}`;
  return `${chip.expanded ? "Collapse" : "Show"} ${children} of ${title}${state}`;
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
