// A vanilla store with zustand/vanilla's surface (`getState`, `setState`,
// `subscribe`), so the list store can move onto zustand's `createStore` by
// changing this file alone.

export type Listener<T> = (state: T, previous: T) => void;

export interface StoreApi<T> {
  getState(): T;
  /** Merges `partial` (or what `partial` returns for the current state) into the state and tells every listener. */
  setState(partial: Partial<T> | ((state: T) => Partial<T>)): void;
  /** Returns the call that unsubscribes. */
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): StoreApi<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  return {
    getState: () => state,
    setState(partial) {
      const next = typeof partial === "function" ? partial(state) : partial;
      if (Object.is(next, state)) return;
      const previous = state;
      state = { ...state, ...next };
      for (const listener of [...listeners]) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
