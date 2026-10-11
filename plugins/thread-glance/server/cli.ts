// `bb thread-glance prefs …`, the same commands and errors as bb's
// `bb thread-list prefs …`, over the settings record the settings page edits.
// A change goes through the same write and reset the page's RPCs use, so every
// open window receives it.
import { PluginCliError, cliCommand, defineCli, type PluginCliRegistration } from "@get-bb/plugin-sdk";
import { DEFAULT_SETTINGS, SETTING_DESCRIPTIONS, SETTING_KEYS, type SettingKey, type Settings } from "../shared/settings";
import { SettingsValidationError } from "./settings-store";

/** What the command needs of the settings: read the record, and edit it as the page does. */
export interface SettingsEditor {
  read(): Promise<Settings>;
  write(patch: Record<string, unknown>): Promise<unknown>;
  reset(keys: readonly SettingKey[]): Promise<unknown>;
}

/** Parses a CLI value as JSON; a bare word such as `full` is read as a string. */
function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

function requireSettingKey(key: string): SettingKey {
  if (isSettingKey(key)) return key;
  throw new PluginCliError(`Unknown preference: ${key}`, {
    code: "unknown_preference",
    hint: `Known preferences: ${SETTING_KEYS.join(", ")}.`,
  });
}

const jsonOption = { type: "boolean", description: "Emit machine-readable JSON" } as const;
const keyPositional = { name: "key", description: "Preference name", required: true } as const;

function keyValueOutput(key: SettingKey, value: unknown, json: boolean): string {
  return json ? JSON.stringify({ key, value }) : `${key} = ${JSON.stringify(value)}`;
}

export function createCli(editor: SettingsEditor): PluginCliRegistration {
  return defineCli({
    name: "thread-glance",
    summary: "Inspect and change Thread Glance's sidebar settings",
    description:
      "The settings page's record for the Thread Glance sidebar: the Working and Inactive shelves, when a thread turns inactive, project colours, snooze shortcuts, automatic settling and the order of child threads. Values are JSON; a bare word is read as a string. Snoozing, parking, settling and reordering threads, and what each device keeps for itself, are not settings: they are done in the sidebar.",
    commands: {
      "prefs list": cliCommand({
        summary: "List every preference and its current value",
        options: { json: jsonOption },
        async run(input) {
          const settings = await editor.read();
          if (input.options.json) return { exitCode: 0, stdout: JSON.stringify(settings) };
          const lines = SETTING_KEYS.map((key) => `${key}\t${JSON.stringify(settings[key])}\t${SETTING_DESCRIPTIONS[key]}`);
          return { exitCode: 0, stdout: lines.join("\n") };
        },
      }),
      "prefs get": cliCommand({
        summary: "Print one preference",
        positionals: [keyPositional],
        options: { json: jsonOption },
        async run(input) {
          const key = requireSettingKey(input.positionals.key);
          const value = (await editor.read())[key];
          return { exitCode: 0, stdout: input.options.json ? JSON.stringify({ key, value }) : JSON.stringify(value) };
        },
      }),
      "prefs set": cliCommand({
        summary: "Set one preference",
        positionals: [
          keyPositional,
          { name: "value", description: `JSON value, e.g. 12, true or '"full"'`, required: true },
        ] as const,
        options: { json: jsonOption },
        async run(input) {
          const key = requireSettingKey(input.positionals.key);
          try {
            await editor.write({ [key]: parseCliValue(input.positionals.value) });
          } catch (error) {
            if (error instanceof SettingsValidationError) {
              throw new PluginCliError(error.message, { code: "invalid_preference_value", hint: SETTING_DESCRIPTIONS[key] });
            }
            throw error;
          }
          return { exitCode: 0, stdout: keyValueOutput(key, (await editor.read())[key], input.options.json === true) };
        },
      }),
      "prefs reset": cliCommand({
        summary: "Restore one preference to its default",
        positionals: [keyPositional],
        options: { json: jsonOption },
        async run(input) {
          const key = requireSettingKey(input.positionals.key);
          await editor.reset([key]);
          return { exitCode: 0, stdout: keyValueOutput(key, DEFAULT_SETTINGS[key], input.options.json === true) };
        },
      }),
    },
  });
}
