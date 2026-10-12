// Which changes are the fleet's own. An echo is recognised only by the rules
// the fleet registered: its marker, its in-progress and needs-input labels,
// and its echo actors. Who else made a change, the operator included, never
// makes it an echo.
import type { Change, Disposition, FleetLabels } from "./model";

const KBD = /^<kbd>([\s\S]*)<\/kbd>$/i;

const unwrap = (text: string): string => {
  const trimmed = text.trim();
  const inner = KBD.exec(trimmed);
  return inner === null ? trimmed : inner[1]!.trim();
};

/**
 * Whether the last non-blank line of `lastLine`, with any `<kbd>` wrapper and
 * surrounding whitespace removed, equals the marker. A quote-reply whose
 * quoted park holds the marker but whose last line is the answer is not one.
 */
export const isMarker = (lastLine: string | null, marker: string): boolean => {
  const wanted = unwrap(marker);
  if (lastLine === null || wanted === "") return false;
  const lines = lastLine.split(/\r\n|\r|\n/);
  const last = lines.reverse().find((line) => line.trim() !== "");
  return last !== undefined && unwrap(last) === wanted;
};

export interface EchoRules {
  readonly labels: FleetLabels;
  readonly marker: string;
  readonly echoActors: readonly string[];
}

/** What becomes of a change: an echo by the first rule that matches (marker, label, echo actor), else a wake. The echo actor rule also matches any other name the service knows the actor by. */
export const classify = (change: Change, fleet: EchoRules): Disposition => {
  const isComment = change.kind === "commented" || change.kind.startsWith("reviewed: ");
  if (isComment && isMarker(change.lastLine, fleet.marker)) return { kind: "echo", rule: "marker" };
  const isLabelChange = change.kind === "labelled" || change.kind === "unlabelled";
  if (isLabelChange && (change.label === fleet.labels.inProgress || change.label === fleet.labels.needsInput)) return { kind: "echo", rule: "label" };
  const names = [change.actor, ...(change.actorAliases ?? [])].flatMap((name) => (name === null ? [] : [name.toLowerCase()]));
  if (fleet.echoActors.some((echoActor) => names.includes(echoActor.toLowerCase()))) return { kind: "echo", rule: "echo actor" };
  return { kind: "wake" };
};
