// The page's saving rule, apart from any rendering: edits wait 500 ms after
// the last one, only the valid edited fields are sent, one save runs at a
// time, and a pending save goes at once when the page is left.
import type { Settings, SettingKey, SettingsErrors, SettingsPatch } from "@/shared/settings";
import { assessEdits, type Edits } from "./edits";

/** How long after the last edit the save goes. */
export const SAVE_DELAY_MS = 500;
/** How long "Saved" shows. */
export const SAVED_SHOWN_MS = 2_000;

/** What the heading says: nothing, "Saving…", "Saved" or "Not saved". */
export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export interface AutosaveState {
  edits: Edits;
  errors: SettingsErrors;
  status: SaveStatus;
}

export interface AutosaveHost {
  /** The server's settings now. */
  current(): Settings;
  /** Sends the patch and shows the server's answer; rejects when the save fails. */
  write(patch: SettingsPatch): Promise<void>;
  /** The save failed. */
  failed(): void;
}

export interface Autosave {
  state(): AutosaveState;
  subscribe(listener: () => void): () => void;
  /** Records a field as typed and restarts the 500 ms wait. */
  edit(key: SettingKey, typed: unknown): void;
  /** Sends what is pending now, and resolves once nothing is in flight. */
  flush(): Promise<void>;
}

export function createAutosave(host: AutosaveHost): Autosave {
  let state: AutosaveState = { edits: {}, errors: {}, status: "idle" };
  const listeners = new Set<() => void>();
  let waiting: ReturnType<typeof setTimeout> | null = null;
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let again = false;

  const set = (patch: Partial<AutosaveState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const clearSaved = () => {
    if (savedTimer !== null) clearTimeout(savedTimer);
    savedTimer = null;
  };

  async function send(): Promise<void> {
    const { patch, errors, unchanged } = assessEdits(host.current(), state.edits);
    const sent = Object.keys(patch) as SettingKey[];
    const rest = { ...state.edits };
    for (const key of unchanged) delete rest[key];
    if (sent.length === 0) {
      set({ edits: rest, errors, status: state.status === "saving" ? "idle" : state.status });
      return;
    }
    const typed = Object.fromEntries(sent.map((key) => [key, state.edits[key]]));
    try {
      await host.write(patch);
    } catch {
      host.failed();
      set({ status: "failed" });
      return;
    }
    // A field edited again while the save ran stays an edit.
    const kept = { ...state.edits };
    for (const key of sent) if (kept[key] === typed[key]) delete kept[key];
    for (const key of unchanged) delete kept[key];
    const busy = waiting !== null || again;
    set({ edits: kept, status: busy ? "saving" : "saved" });
    if (!busy) {
      clearSaved();
      savedTimer = setTimeout(() => {
        savedTimer = null;
        if (state.status === "saved") set({ status: "idle" });
      }, SAVED_SHOWN_MS);
    }
  }

  function run(): Promise<void> {
    if (inFlight !== null) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          again = false;
          await send();
        } while (again);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    edit(key, typed) {
      const edits = { ...state.edits, [key]: typed };
      const { patch, errors } = assessEdits(host.current(), edits);
      clearSaved();
      set({ edits, errors, status: Object.keys(patch).length > 0 || state.status === "saving" ? "saving" : "idle" });
      if (waiting !== null) clearTimeout(waiting);
      waiting = setTimeout(() => {
        waiting = null;
        void run();
      }, SAVE_DELAY_MS);
    },
    flush() {
      if (waiting === null) return inFlight ?? Promise.resolve();
      clearTimeout(waiting);
      waiting = null;
      return run();
    },
  };
}
