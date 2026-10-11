// A value the server publishes whole on every change, with a version that
// rises with each, so a window keeps the latest it saw within one epoch.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Versioned } from "../shared/signals";

export interface VersionedChannel<T> {
  /** The value as its store holds it now, with the version of the last publish. */
  current(): Promise<Versioned<T>>;
  /** Takes the next version for `value`, publishes it and returns it. */
  publish(value: T): Versioned<T>;
}

export function createVersionedChannel<T>(
  bb: Pick<BbPluginApi, "realtime">,
  channel: string,
  epoch: string,
  read: () => T | Promise<T>,
): VersionedChannel<T> {
  let version = 1;
  return {
    async current() {
      return { epoch, version, value: await read() };
    },
    publish(value) {
      version += 1;
      const signal: Versioned<T> = { epoch, version, value };
      bb.realtime.publish(channel, signal);
      return signal;
    },
  };
}
