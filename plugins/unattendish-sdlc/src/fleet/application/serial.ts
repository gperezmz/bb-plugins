/**
 * Runs the work for one key one at a time, in the order it was asked for,
 * while other keys run alongside. Work asked for while its key is idle starts
 * at once, within the call.
 */
export class SerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key);
    const next = previous === undefined ? new Promise<T>((resolve) => resolve(work())) : previous.then(work);
    const settle = () => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
    const tail: Promise<void> = next.then(settle, settle);
    this.tails.set(key, tail);
    return next;
  }
}
