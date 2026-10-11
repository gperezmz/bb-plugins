// Fetches each project's icon once per window. The server answers 204 for a
// project with no icon, which is told apart from an icon that could not be
// read (any other failure, retried on `IconHealth`'s growing wait) by reading
// the response, not by an `<img>` error event, which fires alike for both. A
// project with no icon is asked for once and left alone: its rows keep the
// monogram until the page reloads or its upload changes, which changes the
// URL asked for. Rows read it through `useSyncExternalStore`.
import { IconHealth } from "./icon-health";

export interface IconEnv {
  fetch(url: string): Promise<Response>;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  setTimeout(run: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const browserEnv: IconEnv = {
  fetch: (url) => globalThis.fetch(url),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

interface Entry {
  /** The URL asked for; a new upload is a new URL, and so a new entry. */
  src: string;
  /** The icon as an object URL, once read. */
  url: string | null;
  retry: ReturnType<typeof setTimeout> | null;
}

export class IconLoader {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  constructor(
    private readonly env: IconEnv = browserEnv,
    private readonly health: IconHealth = new IconHealth(),
  ) {}

  /** Asks for the project's icon at `src` unless that was already asked for, whatever the answer was. The answer outlives the row that asked. */
  want(projectId: string, src: string): void {
    const current = this.entries.get(projectId);
    if (current?.src === src) return;
    if (current !== undefined) this.drop(current);
    const entry: Entry = { src, url: null, retry: null };
    this.entries.set(projectId, entry);
    void this.load(projectId, entry);
  }

  /** The icon's object URL for `src`, or null while there is none to draw: asking, none, or waiting to ask again. */
  url(projectId: string, src: string): string | null {
    const entry = this.entries.get(projectId);
    return entry?.src === src ? entry.url : null;
  }

  /** The browser drew the icon: the failures before it are forgotten. Until then they stay counted, so an icon the browser cannot decode keeps its growing wait. */
  drawn(projectId: string, src: string): void {
    if (this.entries.get(projectId)?.src === src) this.health.loaded(projectId);
  }

  /** The browser could not draw the icon it was given: treated as unreadable. */
  broke(projectId: string, src: string): void {
    const entry = this.entries.get(projectId);
    if (entry?.src !== src || entry.url === null) return;
    this.env.revokeObjectUrl(entry.url);
    entry.url = null;
    this.failed(projectId, entry);
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  clear(): void {
    for (const entry of this.entries.values()) this.drop(entry);
    this.entries.clear();
    this.health.clear();
  }

  private async load(projectId: string, entry: Entry): Promise<void> {
    entry.retry = null;
    try {
      const response = await this.env.fetch(entry.src);
      const none = response.status === 204;
      if (!none && !response.ok) throw new Error(`the icon route answered ${response.status}`);
      const blob = none ? null : await response.blob();
      // A newer URL took the project's entry while this answer was on its way.
      if (this.entries.get(projectId) !== entry) return;
      if (blob === null) {
        this.health.loaded(projectId);
        return;
      }
      entry.url = this.env.createObjectUrl(blob);
    } catch {
      if (this.entries.get(projectId) === entry) this.failed(projectId, entry);
      return;
    }
    this.emit();
  }

  private failed(projectId: string, entry: Entry): void {
    entry.retry = this.env.setTimeout(() => void this.load(projectId, entry), this.health.failed(projectId));
  }

  private drop(entry: Entry): void {
    if (entry.retry !== null) this.env.clearTimeout(entry.retry);
    if (entry.url !== null) this.env.revokeObjectUrl(entry.url);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The window's icons: one per window, shared by every row. */
export const iconLoader = new IconLoader();
