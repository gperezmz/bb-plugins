// What the list keeps per window, in the browser's session storage: the
// project scope. A reload keeps it, another window has its own, and a new
// window starts empty. Unlike the device's storage it is not shared between
// windows, so nothing evicts it and no other window's write reaches it.
import type { StorageLike } from "./device-storage";
import { ALL_PROJECTS_SCOPE, type Scope } from "../model/scope";

const SCOPE_KEY = "thread-glance:scope";

/** The most projects a stored scope keeps. */
const MAX_SCOPE = 200;

/** This window's session storage, or null where the browser gives none. */
export function windowStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** The scope saved in `storage`: its project ids without repeats, All projects when absent or unreadable. */
export function readScope(storage: StorageLike | null): Scope {
  try {
    const raw = storage?.getItem(SCOPE_KEY);
    const stored: unknown = raw == null ? null : JSON.parse(raw);
    if (!Array.isArray(stored)) return ALL_PROJECTS_SCOPE;
    const ids = [...new Set(stored.filter((id): id is string => typeof id === "string" && id !== ""))].slice(0, MAX_SCOPE);
    return ids.length === 0 ? ALL_PROJECTS_SCOPE : ids;
  } catch {
    return ALL_PROJECTS_SCOPE;
  }
}

/** Saves `scope` in `storage`; All projects is saved as nothing. A write that fails leaves the scope unsaved. */
export function writeScope(storage: StorageLike | null, scope: Scope): void {
  try {
    if (scope.length === 0) storage?.removeItem(SCOPE_KEY);
    else storage?.setItem(SCOPE_KEY, JSON.stringify(scope));
  } catch {
    // The scope stays in force for this mount, unsaved.
  }
}
