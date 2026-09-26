// Pocket Navigation's backend entry. The plugin is all frontend: bb needs a
// server entry to load it, and this one registers nothing.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function pocketNavigation(_bb: BbPluginApi): void {}
