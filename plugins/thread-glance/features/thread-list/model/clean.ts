// Clean settled resources: the texts of the button and the dialog, and the
// dialog's states from the preview to the result. Pure; the dialog binds them
// to the server's `previewClean` and `runClean`.
import type { PreviewCleanOutput, RunCleanOutput } from "@/shared/ports";
import { portList } from "./ports";

export const CLEAN_BUTTON_LABEL = "Close terminals and ports of settled threads";
export const CLEAN_BUTTON_TIP = "Close terminals and ports of settled threads (threads stay in Settled)";
export const CLEAN_TITLE = "Clean settled resources?";
export const CLEAN_WARNINGS = [
  "This closes terminals even if you typed into them.",
  "A port process may need time to exit after its shutdown request.",
] as const;

/** Where the dialog stands: waiting for a preview, showing one, running it, or showing what came of it. */
export type CleanState =
  | { phase: "loading" }
  | { phase: "preview"; preview: PreviewCleanOutput }
  | { phase: "running"; preview: PreviewCleanOutput }
  | { phase: "done"; result: RunCleanOutput }
  | { phase: "expired" }
  | { phase: "failed"; message: string };

/** Whether a preview lists anything to close. */
export function hasResources(preview: PreviewCleanOutput): boolean {
  return preview.threads.length > 0;
}

/** "N terminals closed · M port shutdown requests sent", each noun singular for one, or "No resources were closed." */
export function cleanSummary(result: RunCleanOutput): string {
  if (result.closedTerminals === 0 && result.portRequests === 0) return "No resources were closed.";
  return `${terminalsText(result.closedTerminals)} closed · ${portRequestsText(result.portRequests)} sent`;
}

/** The line for ports that outlived the request, or null when none did. */
export function stillListeningText(result: RunCleanOutput): string | null {
  return result.stillListening.length === 0 ? null : `Still listening after the request: ${portList(result.stillListening)}`;
}

/** A count of terminals, singular for one, as the preview and the result line read them. */
export function terminalsText(count: number): string {
  return count === 1 ? "1 terminal" : `${count} terminals`;
}

/** The port shutdown requests a run sent, as the result line reads them. */
export function portRequestsText(count: number): string {
  return count === 1 ? "1 port shutdown request" : `${count} port shutdown requests`;
}

/** A thread's ports as the dialog lists them: `:port process`. */
export function portsText(ports: PreviewCleanOutput["threads"][number]["ports"]): string {
  return ports.map(({ port, process }) => (process === null ? `:${port}` : `:${port} ${process}`)).join(", ");
}

/** What the dialog draws for a state: which parts and buttons show, and how they read. */
export interface CleanView {
  /** The preview that is listed, or null while there is none. */
  preview: PreviewCleanOutput | null;
  /** The preview lists threads to clean. */
  found: boolean;
  /** Nothing is left to do: the result is shown, or the preview found nothing. */
  finished: boolean;
  /** The preview was read and holds nothing to close. */
  nothingFound: boolean;
  /** The label of the button that closes the dialog. */
  closeLabel: "Cancel" | "Close";
  /** The button that closes the dialog, and Escape, work. Not while the run is going. */
  dismissible: boolean;
  /** Refresh preview is offered. */
  showRefresh: boolean;
  /** Clean resources is offered; `cleanLabel` is its label and `cleanDisabled` says whether it works. */
  showClean: boolean;
  cleanLabel: "Clean resources" | "Cleaning...";
  cleanDisabled: boolean;
}

export function cleanView(state: CleanState): CleanView {
  const preview = state.phase === "preview" || state.phase === "running" ? state.preview : null;
  const found = preview !== null && hasResources(preview);
  const finished = state.phase === "done" || (state.phase === "preview" && !found);
  const running = state.phase === "running";
  return {
    preview,
    found,
    finished,
    nothingFound: preview !== null && !found,
    closeLabel: finished || state.phase === "expired" || state.phase === "failed" ? "Close" : "Cancel",
    dismissible: !running,
    showRefresh: state.phase === "expired" || state.phase === "failed",
    showClean: found,
    cleanLabel: running ? "Cleaning..." : "Clean resources",
    cleanDisabled: running,
  };
}
