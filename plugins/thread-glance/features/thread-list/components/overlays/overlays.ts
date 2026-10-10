// What rows reach of the list's one hover card and drag-to-split probe: one object for the list's life, so a row takes no
// callback that changes. The hosts that draw them register here.
import { createContext, useContext, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import type { PluginSidebarThreadSplit } from "@get-bb/plugin-sdk/app";
import type { Commands } from "../../commands/commands";
import type { ListStore } from "../../store/api";
import { createRowCard, type RowCardController } from "../row-card";

export interface Overlays {
  card: RowCardController;
  /** The one drag-to-split hook's latest answer, for the thread it was called for. */
  setSplit(threadId: string | null, split: PluginSidebarThreadSplit): void;
  /** Hands a press on `threadId`'s row to bb's drag-to-split, for that thread. */
  forwardSplit(threadId: string, event: PointerEvent<HTMLElement>): void;
}

export function createOverlays(store: ListStore, commands: Commands): Overlays {
  const card = createRowCard(store);
  let probe: { threadId: string | null; split: PluginSidebarThreadSplit } = { threadId: null, split: { splitProps: {} } as PluginSidebarThreadSplit };
  return {
    card,
    setSplit(threadId, split) {
      probe = { threadId, split };
    },
    forwardSplit(threadId, event) {
      // A row can reach the pointer without it entering, when the list
      // scrolls under it: the probe takes this row before it forwards.
      if (probe.threadId !== threadId) flushSync(() => commands.pointAt(threadId));
      if (probe.threadId === threadId) probe.split.splitProps.onPointerDown?.(event);
    },
  };
}

// Debt: a provider outside an app root, as ListContext is (store/hooks.ts):
// bb mounts the list through its slot, so the list's edge assembles it. It
// clears with ListContext's.
export const OverlaysContext = createContext<Overlays | null>(null);

export function useOverlays(): Overlays {
  const overlays = useContext(OverlaysContext);
  if (overlays === null) throw new Error("a list component needs the list's OverlaysContext");
  return overlays;
}
