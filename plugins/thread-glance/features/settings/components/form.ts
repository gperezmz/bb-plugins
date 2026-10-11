import type { SettingKey, SettingsErrors } from "@/shared/settings";
import type { ShownSettings } from "../model/edits";

/** What a group of settings reads and calls: the values shown, the inline errors, and the edit. */
export interface Form {
  values: ShownSettings;
  errors: SettingsErrors;
  edit(key: SettingKey, typed: unknown): void;
}
