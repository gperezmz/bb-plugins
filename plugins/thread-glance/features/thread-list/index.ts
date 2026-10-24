// The thread list feature's public API: the list component bb mounts, the
// keeper that follows the server's data, the icons it registers, and what the
// other parts of the plugin (the thread menu's actions, the thread header's
// buttons, the settings page) use: the lifecycle commands, the Settle sweep,
// and hooks for the server's data. Nothing else of the feature is reached
// from outside. Importing it brings its stylesheet.
import "./theme/theme.css";
export { ThreadList } from "./components/ThreadList";
export { OverlaySyncKeeper } from "./sync/SyncKeeper";
export { EXTRA_ICONS } from "./icons";
export { createLifecycleCommands, lifecycleHostOf, type LifecycleCommands, type LifecycleHost } from "./commands/lifecycle";
export { isCardDrawn, registerCard, useIsSweeping, SWEEP_MS } from "./commands/sweep";
export {
  useAppearance,
  useLifecycleRow,
  useLifecycleRows,
  useManualOrder,
  usePluginData,
  useServerSettings,
} from "./sync/hooks";
export { pluginData } from "./sync";
/** Drops everything the plugin's data holds, as a reload of the app does: for tests, which load the app once per file. */
export { endPluginLifetime } from "./sync/lifetime";
export { portLinkMachine, usePortLinkMachine } from "./storage/port-link-machine";
export { requestSnoozePicker, useSnoozePickerRequests } from "./commands/snooze-picker-request";
// What the thread header's buttons and the settings preview draw with: the
// project mark and colours, the child marks, and the Status slot.
export { ProjectMark, ProjectMonogram, ProjectName, ProjectStripe } from "./project/ProjectMark";
export { useBbProjectIds, useProjectColour } from "./project/use-project-colour";
export {
  automaticColour,
  contrastRatio,
  MONOGRAM_ALPHA,
  projectColours,
  readableColour,
  stripeShown,
  withAlpha,
  type ProjectColour,
  type StripeSurface,
  type ThemeMode,
} from "./model/project-colour";
export { monogramLetter, monogramTile, MONOGRAM_TILE_COLOURS } from "./model/monogram";
export { ChildMark } from "./components/rows/ChildMark";
export { StatusView } from "./components/rows/StatusView";
export { Tip } from "./components/rows/Tip";
export { ageLabel, statusSlot, type StatusSlot } from "./model/status-slot";
export { childComparator, waitingChildTitle } from "./model/forest";
export { isListed } from "./model/listed";
export { chipMarkIds } from "./model/children-chip";
