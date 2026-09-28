// UI Tweaks' backend entry: keeps the two tweaks and serves them to the app.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./shared/contract";
import { createTweakStore } from "./server/store";

export default function uiTweaks(bb: BbPluginApi): void {
  const store = createTweakStore(bb);

  bb.rpc.register(rpcContract, {
    getTweaks: () => store.read(),
    setTweaks: (patch) => store.write(patch),
  });

  // A reinstall can find the rows an earlier install left. bb runs this on
  // an install and not on an update, so a reinstall starts at Medium like a
  // first install while an update keeps the choices.
  bb.onInstall(() => store.clear());
}
