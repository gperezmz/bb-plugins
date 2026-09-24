// The fixed-tab reference shared by the page (to open the tab) and the tab
// component (to read its target). Targets live in memory only.
import type { ExperimentalPluginFixedTabReference, JsonValue } from "@get-bb/plugin-sdk/app";
import { PANEL_ID } from "./hooks.js";

export interface ManifestTarget {
  [key: string]: JsonValue;
  focus: string;
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const manifestTab: ExperimentalPluginFixedTabReference<ManifestTarget> = {
  panelId: PANEL_ID,
  id: "manifest",
  experimental_target: {
    validate(value): value is ManifestTarget {
      return isObject(value) && typeof value.focus === "string";
    },
  },
};
