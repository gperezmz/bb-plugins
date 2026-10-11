// Reordering Pinned and Active: the drag's state, the keyboard move, and the
// optimistic write with its rollback. The pointer itself is the drag
// controller's (components/reorder); this module decides and writes.
import { toast } from "sonner";
import { pluginData } from "../sync";
import { dismissPortsPrompt } from "./ports-prompt";
import { afterHover, idsOfUnits, keyboardMove, orderAfterReorder, pinNeighbours, type Hover } from "../model/reorder";
import type { ListStore } from "../store/list-store";

export const REORDER_ACTIVE_FAILED = "Could not reorder Active thread";
export const REORDER_PINNED_FAILED = "Could not reorder pinned thread";

/** How long a written pin order is held over bb's list while bb's own list catches up. */
const PIN_ORDER_HOLD_MS = 1_000;

export interface ReorderCommands {
  /** Starts a drag of a unit; false when the unit is not in a reorderable list. */
  beginDrag(listKey: string, unitKey: string): boolean;
  /** The pointer is over `hover`: the dragged unit takes its place in the preview. */
  hoverDrag(hover: Hover): void;
  /** Ends the drag and writes the order it put the unit in; nothing is written when it did not move. */
  endDrag(): void;
  /** Abandons the drag without writing. */
  cancelDrag(): void;
  /** Alt+Arrow on a row or group: one slot up or down, announced. */
  moveByKey(rowKey: string, direction: -1 | 1): void;
  /** The list and unit a row or group belongs to, when it can be reordered. */
  placeOf(rowKey: string): { listKey: string; unitKey: string } | null;
}

export function createReorderCommands(store: ListStore): ReorderCommands {
  let writes = 0;
  let announced = 0;
  let pinHold: ReturnType<typeof setTimeout> | null = null;
  /** The unit keys of the dragged list when the drag began. */
  let origin: readonly string[] = [];

  const model = () => store.getState().model;

  const announce = (text: string) => {
    announced += 1;
    // A repeated sentence still reaches a screen reader when the text differs.
    store.setUi({ announcement: announced % 2 === 0 ? text : `${text}​` });
  };

  const releasePinned = () => {
    if (pinHold !== null) clearTimeout(pinHold);
    pinHold = null;
    store.feed({ pinnedOverride: null });
  };

  const write = async (listKey: string, unitKeys: readonly string[], movedKey: string) => {
    const current = model();
    const list = current?.reorderLists.get(listKey);
    if (current === null || list === undefined) {
      store.feed({ drag: null });
      return;
    }
    const ids = idsOfUnits(list, unitKeys);
    if (listKey === "pinned") {
      store.feed({ pinnedOverride: ids, drag: null });
      try {
        await store.edge.sdk.threads.reorderPinned({ threadId: movedKey, ...pinNeighbours(ids, movedKey) });
        // bb's list shows the order a moment after the call answers; the written order stands until then.
        if (pinHold !== null) clearTimeout(pinHold);
        pinHold = setTimeout(releasePinned, PIN_ORDER_HOLD_MS);
      } catch {
        releasePinned();
        toast.error(REORDER_PINNED_FAILED);
      }
      return;
    }
    const inputs = store.getState().inputs;
    const next = orderAfterReorder(inputs.pendingOrder ?? inputs.order, ids);
    writes += 1;
    store.feed({ pendingOrder: next, drag: null });
    try {
      const result = await store.edge.rpc.call("reorder", { threadIds: ids });
      pluginData.orderSignal(result);
      writes -= 1;
      if (writes === 0) store.feed({ order: result.value, pendingOrder: null });
    } catch {
      writes -= 1;
      if (writes === 0) store.feed({ pendingOrder: null });
      toast.error(REORDER_ACTIVE_FAILED);
    }
  };

  const commands: ReorderCommands = {
    placeOf(rowKey) {
      return model()?.reorderOf.get(rowKey) ?? null;
    },

    beginDrag(listKey, unitKey) {
      const list = model()?.reorderLists.get(listKey);
      if (list === undefined || !list.units.some((unit) => unit.key === unitKey)) return false;
      origin = list.units.map((unit) => unit.key);
      // A row's unit key is its thread id: dragging it is an action on the thread.
      dismissPortsPrompt(unitKey);
      store.setUi({ dragging: { listKey, unitKey } });
      store.feed({ drag: { listKey, unitKeys: list.units.map((unit) => unit.key) } });
      return true;
    },

    hoverDrag(hover) {
      const { dragging } = store.getState().ui;
      const { drag } = store.getState().inputs;
      if (dragging === null || drag === null) return;
      const unitKeys = afterHover(drag.unitKeys, dragging.unitKey, hover);
      if (unitKeys !== drag.unitKeys) store.feed({ drag: { listKey: drag.listKey, unitKeys } });
    },

    endDrag() {
      const { dragging } = store.getState().ui;
      const { drag } = store.getState().inputs;
      store.setUi({ dragging: null });
      if (dragging === null || drag === null) return;
      if (drag.unitKeys.length === origin.length && drag.unitKeys.every((key, index) => key === origin[index])) {
        store.feed({ drag: null });
        return;
      }
      void write(dragging.listKey, drag.unitKeys, dragging.unitKey);
    },

    cancelDrag() {
      if (store.getState().ui.dragging === null && store.getState().inputs.drag === null) return;
      store.setUi({ dragging: null });
      store.feed({ drag: null });
    },

    moveByKey(rowKey, direction) {
      const place = model()?.reorderOf.get(rowKey);
      const list = place === undefined ? undefined : model()?.reorderLists.get(place.listKey);
      if (place === undefined || list === undefined) return;
      const move = keyboardMove(list, place.unitKey, direction);
      dismissPortsPrompt(place.unitKey);
      announce(move.announcement);
      if (move.moved) void write(place.listKey, move.unitKeys, place.unitKey);
    },
  };
  return commands;
}
