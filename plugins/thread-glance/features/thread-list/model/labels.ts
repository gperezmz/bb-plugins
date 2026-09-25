// Accessible names: everything a tooltip says is in the aria-label.
import type { OlderRow, ThreadRow } from "./view";
import { FLAG_GLYPHS, type Flag } from "./state";
import { formatDateTime } from "./details";

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
  if (row.homeGroupLabel !== null) parts.push(`in ${row.homeGroupLabel}`);
  if (row.hiddenBadge) parts.push("hidden thread");
  if (row.info.unread && row.info.state.kind !== "unread") parts.push("unread");
  if (options.hasDraft && row.info.state.kind !== "draft") parts.push("unsubmitted draft");
  return `Open ${row.info.thread.displayTitle} — ${parts.join("; ")}`;
}

export function chipLabel(title: string, count: number, flag: Flag | null, expanded: boolean): string {
  const noun = count === 1 ? "child thread" : "child threads";
  const detail = flag === null ? "" : `, ${FLAG_GLYPHS[flag].label}`;
  return `${expanded ? "Collapse" : "Show"} ${count} ${noun} of ${title}${detail}`;
}

/**
 * The fold row's text and accessible name. The family's row says "child
 * threads" so it never reads like the group's "older" row.
 */
export function olderRowText(row: OlderRow): { label: string; ariaLabel: string } {
  const noun = row.count === 1 ? "thread" : "threads";
  if (row.scope === "group") {
    return {
      label: row.expanded ? "Show fewer" : `${row.count} older`,
      ariaLabel: `${row.expanded ? "Hide" : "Show"} ${row.count} older ${noun}`,
    };
  }
  const children = row.count === 1 ? "child thread" : "child threads";
  if (row.expanded) return { label: "Show fewer", ariaLabel: `Hide ${row.count} older ${children}` };
  return { label: `${row.count} more ${children}`, ariaLabel: `Show ${row.count} more ${children}` };
}
