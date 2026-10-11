// The plugin's data, kept for the plugin's lifetime rather than a mount of
// the list: what the rest of the feature may use of it besides its keeper
// components (./SyncKeeper), which alone bind bb's runtime, so the store and
// its tests can use this without loading it.
export { lifecycleRowOf, pluginData, type DataChange, type PluginData } from "./plugin-data";
