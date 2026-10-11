// The saving rule of a picked project colour, apart from any rendering: a
// valid colour waits for the next pick, then goes lowered to the server, and a
// pick that is not a colour is not sent. One colour waits at a time.
import type { Appearance, Versioned } from "@/shared/signals";
import { colourError } from "./icons";

/** How long a picked colour waits for the next before it is saved. */
export const COLOUR_DELAY_MS = 500;

export interface ColourSaveHost {
  /** Sends the colour of a project; rejects when the save fails. */
  write(projectId: string, colour: string): Promise<Versioned<Appearance>>;
  /** The server accepted `colour` and answered with the appearance. */
  saved(answer: Versioned<Appearance>, colour: string): void;
  /** The save failed. */
  failed(error: unknown): void;
}

export interface ColourSave {
  /** Records a typed or picked colour for a project and restarts the wait; one that is no colour cancels what waits. */
  pick(projectId: string, typed: string): void;
  /** Sends the waiting colour now, if any. */
  commit(): void;
  /** Drops the waiting colour. */
  cancel(): void;
}

export function createColourSave(host: ColourSaveHost): ColourSave {
  let waiting: { projectId: string; colour: string; timer: ReturnType<typeof setTimeout> } | null = null;

  const cancel = () => {
    if (waiting !== null) clearTimeout(waiting.timer);
    waiting = null;
  };
  const commit = () => {
    const colour = waiting;
    if (colour === null) return;
    cancel();
    host.write(colour.projectId, colour.colour).then(
      (answer) => host.saved(answer, colour.colour),
      (error: unknown) => host.failed(error),
    );
  };

  return {
    pick(projectId, typed) {
      cancel();
      if (colourError(typed) !== null) return;
      waiting = { projectId, colour: typed.trim().toLowerCase(), timer: setTimeout(commit, COLOUR_DELAY_MS) };
    },
    commit,
    cancel,
  };
}
