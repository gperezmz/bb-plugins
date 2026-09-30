// When the list's one hover card opens: after the pointer really moves over a
// row, or when a key moved focus onto it. Rows sliding under a still
// pointer, focus put back after navigation, and the row you just left open
// nothing. Never for the focused thread's row, never while a menu is open or
// a row is being renamed, not after a press until the pointer leaves, and a
// navigation drops a pending open. One controller serves every row.
import type { ListStore, OpenCard } from "../store/api";

const OPEN_DELAY = 500;
/** Leaving the row, or its focus, closes the card this long after, unless the pointer reaches the card. */
const CLOSE_DELAY = 100;
/** Keys that move focus, so the focus they bring may show a card. */
const FOCUS_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/** The row a card would open for, and the element it anchors to. */
export type CardTarget = OpenCard;

export interface RowCardController {
  pointerEnter(event: { clientX: number; clientY: number }): void;
  pointerMove(target: CardTarget, event: { clientX: number; clientY: number; pointerType: string }): void;
  pointerLeave(): void;
  press(): void;
  focus(target: CardTarget): void;
  blur(): void;
  /** The pointer is on the card: it stays open. */
  holdOpen(): void;
  close(): void;
  /** Drops every pending open, for a navigation. */
  cancelPending(): void;
  /** Listens for keys and presses while the list is mounted; returns the call that stops. */
  attach(): () => void;
}

/** The card may open for `threadId` now: see the rules above. */
export function cardAllowed(store: ListStore, threadId: string): boolean {
  const { ui, inputs, layout } = store.getState();
  return !layout.compact && ui.menu === null && ui.editingId === null && ui.renaming === null && inputs.activeThreadId !== threadId;
}

export function createRowCard(store: ListStore): RowCardController {
  /** The last input was a key that moves focus: `:focus-visible`, as far as the card is concerned. */
  let keyed = false;
  /** Bumped by every press and every navigation; an open scheduled before a bump never happens. */
  let epoch = 0;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  // Where the pointer entered: a move must leave this spot.
  let entry: { x: number; y: number } | null = null;
  // A press holds the card shut until the pointer leaves the row.
  let pressed = false;

  const cancel = () => {
    if (openTimer !== null) clearTimeout(openTimer);
    openTimer = null;
  };
  const keepOpen = () => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  };
  const close = () => {
    cancel();
    keepOpen();
    if (store.getState().ui.card !== null) store.setUi({ card: null });
  };
  const closeSoon = () => {
    keepOpen();
    if (store.getState().ui.card === null) return;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      store.setUi({ card: null });
    }, CLOSE_DELAY);
  };
  const schedule = (target: CardTarget) => {
    const open = store.getState().ui.card;
    if (open !== null && open.groupId === target.groupId && open.rowKey === target.rowKey) {
      keepOpen();
      return;
    }
    if (openTimer !== null || pressed || !cardAllowed(store, target.threadId)) return;
    const at = epoch;
    openTimer = setTimeout(() => {
      openTimer = null;
      if (epoch !== at || !cardAllowed(store, target.threadId) || !target.anchor.isConnected) return;
      keepOpen();
      store.setUi({ card: target });
    }, OPEN_DELAY);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    keyed = FOCUS_KEYS.has(event.key);
  };
  const onPress = () => {
    keyed = false;
    epoch += 1;
  };

  return {
    pointerEnter(event) {
      entry = { x: event.clientX, y: event.clientY };
    },
    pointerMove(target, event) {
      if (event.pointerType === "touch") return;
      const from = entry;
      if (from !== null && from.x === event.clientX && from.y === event.clientY) return;
      entry = null;
      schedule(target);
    },
    pointerLeave() {
      cancel();
      entry = null;
      pressed = false;
      closeSoon();
    },
    press() {
      pressed = true;
      close();
    },
    focus(target) {
      // One key, one focus: focus moved by code afterwards opens nothing.
      if (!keyed) return;
      keyed = false;
      schedule(target);
    },
    blur() {
      cancel();
      closeSoon();
    },
    holdOpen: keepOpen,
    close,
    cancelPending() {
      epoch += 1;
      cancel();
    },
    attach() {
      // Keys pressed while no list listened say nothing about the next focus.
      keyed = false;
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("pointerdown", onPress, true);
      // Becoming the focused thread, or a menu or rename taking the list, closes the card.
      const unsubscribe = store.subscribe(() => {
        const card = store.getState().ui.card;
        if (card !== null && !cardAllowed(store, card.threadId)) close();
      });
      return () => {
        close();
        unsubscribe();
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("pointerdown", onPress, true);
      };
    },
  };
}
