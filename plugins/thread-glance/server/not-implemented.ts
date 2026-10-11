// A handler that exists so the contract is whole before its feature is built.
// The feature replaces the handler; until then a caller gets this error.

export class NotImplementedError extends Error {
  readonly feature: string;

  constructor(rpc: string, feature: string) {
    super(`${rpc} is not built yet (${feature}).`);
    this.name = "NotImplementedError";
    this.feature = feature;
  }
}

/** A handler for `rpc` that throws `NotImplementedError` naming the `feature` that owes it. */
export function notImplemented(rpc: string, feature: string): () => never {
  return () => {
    throw new NotImplementedError(rpc, feature);
  };
}
