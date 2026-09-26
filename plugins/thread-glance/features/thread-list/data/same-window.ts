// The list and the settings panel mount apart, each with its own copy of the
// preferences. A change made in one reaches the other here, in the same
// window, at once; the server and localStorage stay what other windows read.

export interface SameWindow<Patch> {
  /** Hears every patch another copy makes; returns the call that stops it. */
  join(apply: (patch: Patch) => void): () => void;
  /** Hands `patch` to every copy but the one that made it. */
  tell(from: (patch: Patch) => void, patch: Patch): void;
}

export function sameWindow<Patch>(): SameWindow<Patch> {
  const copies = new Set<(patch: Patch) => void>();
  return {
    join(apply) {
      copies.add(apply);
      return () => {
        copies.delete(apply);
      };
    },
    tell(from, patch) {
      for (const apply of copies) if (apply !== from) apply(patch);
    },
  };
}
