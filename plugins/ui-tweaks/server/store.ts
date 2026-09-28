// The saved tweaks: one row per tweak in the plugin's key-value store, so
// they survive a bb restart and a plugin update. A missing or unreadable row
// reads as Medium.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DEFAULT_TWEAKS, TWEAK_KEYS, TWEAKS_CHANNEL, parseChoice, type TweakKey, type Tweaks } from "../shared/tweaks";

function kvKey(key: TweakKey): string {
  return `tweak:${key}`;
}

export interface TweakStore {
  read(): Promise<Tweaks>;
  /** Stores the tweaks given, announces the result to every window and returns it. */
  write(patch: Partial<Tweaks>): Promise<Tweaks>;
  /** Deletes every stored tweak, so both read as Medium again. */
  clear(): Promise<void>;
}

export function createTweakStore(bb: Pick<BbPluginApi, "storage" | "realtime">): TweakStore {
  const { kv } = bb.storage;

  async function read(): Promise<Tweaks> {
    const tweaks = { ...DEFAULT_TWEAKS };
    for (const key of TWEAK_KEYS) {
      const choice = parseChoice(key, await kv.get(kvKey(key)));
      if (choice !== undefined) Object.assign(tweaks, { [key]: choice });
    }
    return tweaks;
  }

  return {
    read,
    async write(patch) {
      // The RPC contract has validated the patch.
      for (const key of TWEAK_KEYS) {
        if (patch[key] !== undefined) await kv.set(kvKey(key), patch[key]);
      }
      const tweaks = await read();
      bb.realtime.publish(TWEAKS_CHANNEL, tweaks);
      return tweaks;
    },
    async clear() {
      for (const key of TWEAK_KEYS) await kv.delete(kvKey(key));
    },
  };
}
