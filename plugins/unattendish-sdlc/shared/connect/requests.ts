// The Connect popup is opened from cards, toasts and Settings, none of which holds the others, and it must open
// over the current view whichever it was asked from. A request is recorded here, and the overlay mounted once
// per bb window by the app root draws the popup for it, as `pending-open.ts` hands the Fleet tab a wish.
import { useSyncExternalStore } from "react";
import type { ConnectTarget } from "@/src/fleet/application/views";

/** What the popup is opened for. */
export interface ConnectRequest {
  /** A fleet's half, or (Add account) a service and place with no fleet; the popup asks for what is missing. */
  readonly target: ConnectTarget;
  /** An account the popup is opened at the token step for: Renew, and Add token for another owner. */
  readonly account?: string;
  /** Renew: the credential the new token replaces. */
  readonly replaces?: string;
}

/** A request, and which asking it came from: two requests alike are still two popups. */
export interface Asked {
  readonly request: ConnectRequest;
  readonly serial: number;
}

let current: Asked | null = null;
let serial = 0;
const changed = new Set<() => void>();
const saved = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  changed.add(listener);
  return () => {
    changed.delete(listener);
  };
}

/** Opens the popup for a request, replacing any popup that is open. */
export function openConnect(request: ConnectRequest): void {
  current = { request, serial: ++serial };
  for (const listener of [...changed]) listener();
}

export function closeConnect(): void {
  current = null;
  for (const listener of [...changed]) listener();
}

/** The request the popup is open for right now; null when it is closed. */
export const currentConnect = (): Asked | null => current;

/** The same, redrawing whoever reads it when it changes. */
export function useConnectRequest(): Asked | null {
  return useSyncExternalStore(subscribe, currentConnect);
}

/** Tells whoever lists accounts that the popup stored something, so a list need not wait for the server's signal. */
export function announceConnectSaved(): void {
  for (const listener of [...saved]) listener();
}

export function onConnectSaved(listener: () => void): () => void {
  saved.add(listener);
  return () => {
    saved.delete(listener);
  };
}
